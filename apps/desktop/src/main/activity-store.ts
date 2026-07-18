import { DatabaseSync } from "node:sqlite";
import type { ActivityItem } from "../shared/desktop-api";
import { redactCloudText } from "./cloud-redaction";

type ActivityRow = {
  id: string;
  kind: ActivityItem["kind"];
  title: string;
  detail: string;
  occurred_at: string;
};

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
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS work_activities_occurred_at
      ON work_activities(occurred_at DESC);
    `);
  }

  append(item: ActivityItem): ActivityItem {
    const safe = {
      ...item,
      title: redactCloudText(item.title).slice(0, 512),
      detail: redactCloudText(item.detail).slice(0, 8_192)
    };
    this.db.prepare(`
      INSERT OR IGNORE INTO work_activities (id, kind, title, detail, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(safe.id, safe.kind, safe.title, safe.detail, safe.occurredAt);
    this.db.prepare(`
      DELETE FROM work_activities WHERE id IN (
        SELECT id FROM work_activities ORDER BY occurred_at DESC LIMIT -1 OFFSET 1000
      )
    `).run();
    return safe;
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
      occurredAt: row.occurred_at
    }));
  }

  close(): void {
    this.db.close();
  }
}
