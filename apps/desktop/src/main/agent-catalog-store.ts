import { DatabaseSync } from "node:sqlite";
import type { DesktopAgentProfile } from "../shared/desktop-api";

type AgentRow = {
  profile_json: string;
};

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
        cached_at TEXT NOT NULL
      );
    `);
  }

  list(): DesktopAgentProfile[] {
    const rows = this.db.prepare(`
      SELECT profile_json
      FROM desktop_agent_catalog
      ORDER BY cached_at DESC, agent_id ASC
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

  replace(profiles: DesktopAgentProfile[]): void {
    const cachedAt = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM desktop_agent_catalog;");
      const insert = this.db.prepare(`
        INSERT INTO desktop_agent_catalog (
          agent_id, revision, profile_json, cached_at
        ) VALUES (?, ?, ?, ?)
      `);
      for (const profile of profiles) {
        insert.run(
          profile.id,
          profile.revision,
          JSON.stringify(profile),
          cachedAt
        );
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
