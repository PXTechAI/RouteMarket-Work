import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkerError } from "./errors";

export type LocalProject = {
  localProjectId: string;
  displayName: string;
  hasFolder: boolean;
  rootPath: string;
  realRootPath: string;
  rootFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectRow = {
  local_project_id: string;
  display_name: string;
  root_path: string;
  real_root_path: string;
  root_fingerprint: string;
  created_at: string;
  updated_at: string;
};

export class ProjectRegistry {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_projects (
        local_project_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        real_root_path TEXT NOT NULL,
        root_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async bindFolder(rootPath: string): Promise<LocalProject> {
    const absoluteRoot = resolve(rootPath);
    const stat = await lstat(absoluteRoot).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new WorkerError("PROJECT_ROOT_INVALID", "Selected project root is not a directory.");
    }

    const realRootPath = await realpath(absoluteRoot);
    const existing = this.db.prepare(
      "SELECT * FROM local_projects WHERE real_root_path = ? LIMIT 1"
    ).get(realRootPath) as ProjectRow | undefined;
    if (existing) {
      return this.mapRow(existing);
    }

    const now = new Date().toISOString();
    const project: LocalProject = {
      localProjectId: `project_${randomUUID().replaceAll("-", "")}`,
      displayName: basename(realRootPath),
      hasFolder: true,
      rootPath: absoluteRoot,
      realRootPath,
      rootFingerprint: `sha256:${createHash("sha256").update(realRootPath).digest("hex")}`,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(`
      INSERT INTO local_projects (
        local_project_id,
        display_name,
        root_path,
        real_root_path,
        root_fingerprint,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.localProjectId,
      project.displayName,
      project.rootPath,
      project.realRootPath,
      project.rootFingerprint,
      project.createdAt,
      project.updatedAt
    );
    return project;
  }

  create(displayName: string): LocalProject {
    const normalizedName = displayName.trim();
    if (!normalizedName || normalizedName.length > 120) {
      throw new WorkerError("PROJECT_NAME_INVALID", "Project name must contain 1 to 120 characters.");
    }
    const now = new Date().toISOString();
    const project: LocalProject = {
      localProjectId: `project_${randomUUID().replaceAll("-", "")}`,
      displayName: normalizedName,
      hasFolder: false,
      rootPath: "",
      realRootPath: "",
      rootFingerprint: "",
      createdAt: now,
      updatedAt: now
    };
    this.insert(project);
    return project;
  }

  async attachFolder(localProjectId: string, rootPath: string): Promise<LocalProject> {
    const project = this.getAny(localProjectId);
    if (!project) throw new WorkerError("PROJECT_NOT_FOUND", "Project not found.");
    const absoluteRoot = resolve(rootPath);
    const stat = await lstat(absoluteRoot).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new WorkerError("PROJECT_ROOT_INVALID", "Selected project root is not a directory.");
    }
    const realRootPath = await realpath(absoluteRoot);
    const existing = this.db.prepare(
      "SELECT local_project_id FROM local_projects WHERE real_root_path = ? AND local_project_id <> ? LIMIT 1"
    ).get(realRootPath, localProjectId) as { local_project_id: string } | undefined;
    if (existing) {
      throw new WorkerError("PROJECT_ROOT_ALREADY_BOUND", "This folder is already linked to another project.");
    }
    const updatedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE local_projects
      SET root_path = ?, real_root_path = ?, root_fingerprint = ?, updated_at = ?
      WHERE local_project_id = ?
    `).run(
      absoluteRoot,
      realRootPath,
      `sha256:${createHash("sha256").update(realRootPath).digest("hex")}`,
      updatedAt,
      localProjectId
    );
    return this.getAny(localProjectId)!;
  }

  delete(localProjectId: string): boolean {
    return this.db.prepare(
      "DELETE FROM local_projects WHERE local_project_id = ?"
    ).run(localProjectId).changes > 0;
  }

  get(localProjectId: string): LocalProject | null {
    const project = this.getAny(localProjectId);
    return project?.hasFolder ? project : null;
  }

  private getAny(localProjectId: string): LocalProject | null {
    const row = this.db.prepare(
      "SELECT * FROM local_projects WHERE local_project_id = ? LIMIT 1"
    ).get(localProjectId) as ProjectRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  list(): LocalProject[] {
    const rows = this.db.prepare(
      "SELECT * FROM local_projects ORDER BY updated_at DESC"
    ).all() as ProjectRow[];
    return rows.map((row) => this.mapRow(row));
  }

  close(): void {
    this.db.close();
  }

  private mapRow(row: ProjectRow): LocalProject {
    return {
      localProjectId: row.local_project_id,
      displayName: row.display_name,
      hasFolder: Boolean(row.real_root_path),
      rootPath: row.root_path,
      realRootPath: row.real_root_path,
      rootFingerprint: row.root_fingerprint,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private insert(project: LocalProject): void {
    this.db.prepare(`
      INSERT INTO local_projects (
        local_project_id, display_name, root_path, real_root_path,
        root_fingerprint, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.localProjectId,
      project.displayName,
      project.rootPath,
      project.realRootPath,
      project.rootFingerprint,
      project.createdAt,
      project.updatedAt
    );
  }
}
