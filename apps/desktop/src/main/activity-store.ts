import { DatabaseSync } from "node:sqlite";
import type { ActivityItem } from "../shared/desktop-api";
import { redactCloudText } from "./cloud-redaction";

type ActivityRow = {
  id: string;
  kind: ActivityItem["kind"];
  title: string;
  detail: string;
  occurred_at: string;
  first_occurred_at: string;
  occurrence_count: number;
};

const DEDUPLICATION_WINDOW_MS = 5 * 60 * 1000;

export class ActivityStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_activities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        first_occurred_at TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS work_activities_occurred_at
      ON work_activities(occurred_at DESC);
    `);
    this.ensureColumn("first_occurred_at", "TEXT");
    this.ensureColumn("occurrence_count", "INTEGER NOT NULL DEFAULT 1");
    this.db.exec(`
      UPDATE work_activities
      SET first_occurred_at = occurred_at
      WHERE first_occurred_at IS NULL OR first_occurred_at = '';
    `);
    this.redactExistingActivities();
    this.compactRepeatedCloudErrors();
  }

  append(item: ActivityItem): ActivityItem {
    const safe = {
      ...item,
      title: redactCloudText(item.title).slice(0, 512),
      detail: redactCloudText(item.detail).slice(0, 8_192)
    };
    const previous = this.db.prepare(`
      SELECT * FROM work_activities
      WHERE kind = ? AND title = ? AND detail = ?
      ORDER BY occurred_at DESC
      LIMIT 1
    `).get(safe.kind, safe.title, safe.detail) as ActivityRow | undefined;
    if (previous && withinDeduplicationWindow(previous.occurred_at, safe.occurredAt)) {
      const occurrenceCount = previous.occurrence_count + 1;
      this.db.prepare(`
        UPDATE work_activities
        SET occurred_at = ?, occurrence_count = ?
        WHERE id = ?
      `).run(safe.occurredAt, occurrenceCount, previous.id);
      return {
        ...safe,
        id: previous.id,
        firstOccurredAt: previous.first_occurred_at,
        occurrenceCount
      };
    }
    this.db.prepare(`
      INSERT OR IGNORE INTO work_activities (
        id, kind, title, detail, occurred_at, first_occurred_at, occurrence_count
      ) VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(safe.id, safe.kind, safe.title, safe.detail, safe.occurredAt, safe.occurredAt);
    this.db.prepare(`
      DELETE FROM work_activities WHERE id IN (
        SELECT id FROM work_activities ORDER BY occurred_at DESC LIMIT -1 OFFSET 1000
      )
    `).run();
    return safe;
  }

  clear(): void {
    this.db.exec("DELETE FROM work_activities;");
  }

  list(limit = 200): ActivityItem[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM work_activities ORDER BY occurred_at DESC LIMIT ?
    `).all(safeLimit) as ActivityRow[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      occurredAt: row.occurred_at,
      firstOccurredAt: row.first_occurred_at,
      occurrenceCount: row.occurrence_count
    }));
  }

  private ensureColumn(name: string, definition: string): void {
    const columns = this.db.prepare("PRAGMA table_info(work_activities)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === name)) {
      this.db.exec(`ALTER TABLE work_activities ADD COLUMN ${name} ${definition};`);
    }
  }

  private compactRepeatedCloudErrors(): void {
    const groups = this.db.prepare(`
      SELECT
        kind,
        title,
        detail,
        MIN(first_occurred_at) AS first_occurred_at,
        MAX(occurred_at) AS occurred_at,
        SUM(occurrence_count) AS occurrence_count
      FROM work_activities
      WHERE kind = 'cloud.error'
      GROUP BY kind, title, detail
      HAVING COUNT(*) > 1
    `).all() as ActivityRow[];

    for (const group of groups) {
      const latest = this.db.prepare(`
        SELECT id FROM work_activities
        WHERE kind = ? AND title = ? AND detail = ?
        ORDER BY occurred_at DESC
        LIMIT 1
      `).get(group.kind, group.title, group.detail) as { id: string };
      this.db.prepare(`
        UPDATE work_activities
        SET first_occurred_at = ?, occurred_at = ?, occurrence_count = ?
        WHERE id = ?
      `).run(
        group.first_occurred_at,
        group.occurred_at,
        group.occurrence_count,
        latest.id
      );
      this.db.prepare(`
        DELETE FROM work_activities
        WHERE kind = ? AND title = ? AND detail = ? AND id <> ?
      `).run(group.kind, group.title, group.detail, latest.id);
    }
  }

  private redactExistingActivities(): void {
    const rows = this.db.prepare(
      "SELECT id, title, detail FROM work_activities"
    ).all() as Array<{ id: string; title: string; detail: string }>;
    const update = this.db.prepare(
      "UPDATE work_activities SET title = ?, detail = ? WHERE id = ?"
    );
    this.db.exec("BEGIN");
    try {
      for (const row of rows) {
        const title = redactCloudText(row.title).slice(0, 512);
        const detail = redactCloudText(row.detail).slice(0, 8_192);
        if (title !== row.title || detail !== row.detail) {
          update.run(title, detail, row.id);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

function withinDeduplicationWindow(previous: string, current: string): boolean {
  const elapsed = new Date(current).getTime() - new Date(previous).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= DEDUPLICATION_WINDOW_MS;
}
