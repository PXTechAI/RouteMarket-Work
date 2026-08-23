import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DesktopAgentProfile } from "../shared/desktop-api";

type AgentRow = {
  profile_json: string;
};

type TableColumn = {
  name: string;
};

const LEGACY_SPACE_CACHE_MIGRATION = "legacy_space_cache_v1";

export class AgentCatalogStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS desktop_agent_catalog (
        agent_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        profile_json TEXT NOT NULL,
        sort_index INTEGER NOT NULL DEFAULT 0,
        cached_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desktop_agent_catalog_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(desktop_agent_catalog)").all() as TableColumn[];
    if (!columns.some((column) => column.name === "sort_index")) {
      this.db.exec("ALTER TABLE desktop_agent_catalog ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;");
    }
  }

  list(): DesktopAgentProfile[] {
    return readProfiles(this.db);
  }

  replace(profiles: DesktopAgentProfile[]): void {
    const cachedAt = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM desktop_agent_catalog;");
      const insert = this.db.prepare(`
        INSERT INTO desktop_agent_catalog (
          agent_id, revision, profile_json, sort_index, cached_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const [sortIndex, profile] of profiles.entries()) {
        insert.run(
          profile.id,
          profile.revision,
          JSON.stringify(profile),
          sortIndex,
          cachedAt
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  migrateFrom(databasePaths: string[]): number {
    const alreadyMigrated = this.db.prepare(`
      SELECT value
      FROM desktop_agent_catalog_meta
      WHERE key = ?
    `).get(LEGACY_SPACE_CACHE_MIGRATION);
    if (alreadyMigrated) return 0;

    const merged = new Map(this.list().map((profile) => [profile.id, profile]));
    let migrated = 0;
    for (const databasePath of [...new Set(databasePaths)]) {
      if (!existsSync(databasePath)) continue;
      let legacy: DatabaseSync | null = null;
      try {
        legacy = new DatabaseSync(databasePath, { readOnly: true });
        const table = legacy.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'desktop_agent_catalog'
        `).get();
        if (!table) continue;
        for (const profile of readProfiles(legacy)) {
          const existing = merged.get(profile.id);
          if (!existing || profile.revision > existing.revision) {
            merged.set(profile.id, profile);
            migrated += 1;
          }
        }
      } catch {
        // A damaged or unrelated legacy database must not prevent startup.
      } finally {
        legacy?.close();
      }
    }

    if (migrated > 0) this.replace([...merged.values()]);
    this.db.prepare(`
      INSERT OR REPLACE INTO desktop_agent_catalog_meta (key, value)
      VALUES (?, ?)
    `).run(LEGACY_SPACE_CACHE_MIGRATION, new Date().toISOString());
    return migrated;
  }

  close(): void {
    this.db.close();
  }
}

function readProfiles(database: DatabaseSync): DesktopAgentProfile[] {
  const rows = database.prepare(`
    SELECT profile_json
    FROM desktop_agent_catalog
    ORDER BY sort_index ASC, agent_id ASC
  `).all() as AgentRow[];
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.profile_json) as unknown;
      return validAgentProfile(parsed) ? [{
        ...parsed,
        origin: parsed.origin === "template" ? "template" : "personal",
        forkSourceId: typeof parsed.forkSourceId === "string" ? parsed.forkSourceId : null
      }] : [];
    } catch {
      return [];
    }
  });
}

function validAgentProfile(value: unknown): value is DesktopAgentProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === "string" &&
    typeof profile.revision === "number" &&
    Number.isInteger(profile.revision) &&
    typeof profile.name === "string" &&
    typeof profile.systemPrompt === "string" &&
    Array.isArray(profile.skills) &&
    Array.isArray(profile.toolPermissions) &&
    Array.isArray(profile.tools)
  );
}
