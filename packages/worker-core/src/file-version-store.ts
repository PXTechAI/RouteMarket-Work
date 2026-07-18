import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkerError } from "./errors";

export type ProjectFileVersionSource = "baseline" | "saved" | "created" | "restored";

export type ProjectFileVersionSummary = {
  versionId: string;
  localProjectId: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  source: ProjectFileVersionSource;
  createdAt: string;
};

export type ProjectFileVersion = ProjectFileVersionSummary & { text: string };

type VersionRow = {
  version_id: string;
  local_project_id: string;
  relative_path: string;
  sha256: string;
  text: string;
  bytes: number;
  source: ProjectFileVersionSource;
  created_at: string;
};

const MAX_VERSION_BYTES = 262_144;
const MAX_VERSIONS_PER_FILE = 50;

export class FileVersionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_file_versions (
        version_id TEXT PRIMARY KEY,
        local_project_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        text TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_file_versions_path_idx
        ON project_file_versions(local_project_id, relative_path, created_at DESC);
    `);
  }

  record(input: {
    localProjectId: string;
    relativePath: string;
    sha256: string;
    text: string;
    source: ProjectFileVersionSource;
  }): ProjectFileVersion {
    const bytes = Buffer.byteLength(input.text, "utf8");
    if (bytes > MAX_VERSION_BYTES) {
      throw new WorkerError("FILE_VERSION_TOO_LARGE", "File versions cannot exceed 256 KiB.");
    }
    const latest = this.db.prepare(`
      SELECT * FROM project_file_versions
      WHERE local_project_id = ? AND relative_path = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(input.localProjectId, input.relativePath) as VersionRow | undefined;
    if (latest?.sha256 === input.sha256) return mapVersion(latest);

    const version: ProjectFileVersion = {
      versionId: `version_${randomUUID().replaceAll("-", "")}`,
      localProjectId: input.localProjectId,
      relativePath: input.relativePath,
      sha256: input.sha256,
      text: input.text,
      bytes,
      source: input.source,
      createdAt: new Date().toISOString()
    };
    this.db.prepare(`
      INSERT INTO project_file_versions (
        version_id, local_project_id, relative_path, sha256, text, bytes, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      version.versionId,
      version.localProjectId,
      version.relativePath,
      version.sha256,
      version.text,
      version.bytes,
      version.source,
      version.createdAt
    );
    this.prune(input.localProjectId, input.relativePath);
    return version;
  }

  list(localProjectId: string, relativePath: string): ProjectFileVersionSummary[] {
    const rows = this.db.prepare(`
      SELECT * FROM project_file_versions
      WHERE local_project_id = ? AND relative_path = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(localProjectId, relativePath, MAX_VERSIONS_PER_FILE) as VersionRow[];
    return rows.map(({ text: _text, ...row }) => mapSummary(row));
  }

  get(localProjectId: string, relativePath: string, versionId: string): ProjectFileVersion {
    const row = this.db.prepare(`
      SELECT * FROM project_file_versions
      WHERE version_id = ? AND local_project_id = ? AND relative_path = ? LIMIT 1
    `).get(versionId, localProjectId, relativePath) as VersionRow | undefined;
    if (!row) throw new WorkerError("FILE_VERSION_NOT_FOUND", "Project file version not found.");
    return mapVersion(row);
  }

  close(): void { this.db.close(); }

  private prune(localProjectId: string, relativePath: string): void {
    this.db.prepare(`
      DELETE FROM project_file_versions
      WHERE local_project_id = ? AND relative_path = ? AND version_id NOT IN (
        SELECT version_id FROM project_file_versions
        WHERE local_project_id = ? AND relative_path = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?
      )
    `).run(localProjectId, relativePath, localProjectId, relativePath, MAX_VERSIONS_PER_FILE);
  }
}

function mapSummary(row: Omit<VersionRow, "text">): ProjectFileVersionSummary {
  return {
    versionId: row.version_id,
    localProjectId: row.local_project_id,
    relativePath: row.relative_path,
    sha256: row.sha256,
    bytes: row.bytes,
    source: row.source,
    createdAt: row.created_at
  };
}

function mapVersion(row: VersionRow): ProjectFileVersion {
  return { ...mapSummary(row), text: row.text };
}
