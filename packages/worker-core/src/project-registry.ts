import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkerError } from "./errors";

export type LocalProject = {
  localProjectId: string;
  displayName: string;
  hasFolder: boolean;
  folderStatus: "unlinked" | "available" | "missing" | "unavailable";
  rootPath: string;
  realRootPath: string;
  rootFingerprint: string;
  folders: LocalProjectFolder[];
  createdAt: string;
  updatedAt: string;
};

export type LocalProjectFolder = {
  folderId: string;
  name: string;
  rootPath: string;
  realRootPath: string;
  rootFingerprint: string;
  status: "available" | "missing" | "unavailable";
  primary: boolean;
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

type ProjectFolderRow = {
  local_project_id: string;
  folder_id: string;
  root_path: string;
  real_root_path: string;
  root_fingerprint: string;
  created_at: string;
};

export class ProjectRegistry {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON;");
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
      CREATE TABLE IF NOT EXISTS local_project_folders (
        local_project_id TEXT NOT NULL,
        folder_id TEXT NOT NULL,
        root_path TEXT NOT NULL,
        real_root_path TEXT NOT NULL UNIQUE,
        root_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (local_project_id, folder_id),
        FOREIGN KEY (local_project_id) REFERENCES local_projects(local_project_id) ON DELETE CASCADE
      );
    `);
    this.db.exec(`
      INSERT OR IGNORE INTO local_project_folders (
        local_project_id, folder_id, root_path, real_root_path, root_fingerprint, created_at
      )
      SELECT local_project_id, root_fingerprint, root_path, real_root_path, root_fingerprint, created_at
      FROM local_projects
      WHERE real_root_path <> '';
    `);
  }

  async bindFolder(rootPath: string): Promise<LocalProject> {
    const absoluteRoot = resolve(rootPath);
    const stat = await lstat(absoluteRoot).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new WorkerError("PROJECT_ROOT_INVALID", "Selected project root is not a directory.");
    }

    const realRootPath = await realpath(absoluteRoot);
    const existing = this.db.prepare(`
      SELECT project.* FROM local_project_folders folder
      JOIN local_projects project ON project.local_project_id = folder.local_project_id
      WHERE folder.real_root_path = ? LIMIT 1
    `).get(realRootPath) as ProjectRow | undefined;
    if (existing) {
      return this.mapRow(existing);
    }

    const now = new Date().toISOString();
    const project: LocalProject = {
      localProjectId: `project_${randomUUID().replaceAll("-", "")}`,
      displayName: basename(realRootPath),
      hasFolder: true,
      folderStatus: "available",
      rootPath: absoluteRoot,
      realRootPath,
      rootFingerprint: `sha256:${createHash("sha256").update(realRootPath).digest("hex")}`,
      folders: [],
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
    this.insertFolder(project.localProjectId, project.rootPath, project.realRootPath, project.rootFingerprint, project.createdAt);
    return this.getAny(project.localProjectId)!;
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
      folderStatus: "unlinked",
      rootPath: "",
      realRootPath: "",
      rootFingerprint: "",
      folders: [],
      createdAt: now,
      updatedAt: now
    };
    this.insert(project);
    return project;
  }

  rename(localProjectId: string, displayName: string): LocalProject {
    const normalizedName = displayName.trim();
    if (!normalizedName || normalizedName.length > 120) {
      throw new WorkerError("PROJECT_NAME_INVALID", "Project name must contain 1 to 120 characters.");
    }
    if (!this.getAny(localProjectId)) {
      throw new WorkerError("PROJECT_NOT_FOUND", "Project not found.");
    }
    this.db.prepare(`
      UPDATE local_projects SET display_name = ?, updated_at = ?
      WHERE local_project_id = ?
    `).run(normalizedName, new Date().toISOString(), localProjectId);
    return this.getAny(localProjectId)!;
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
      "SELECT local_project_id FROM local_project_folders WHERE real_root_path = ? LIMIT 1"
    ).get(realRootPath) as { local_project_id: string } | undefined;
    if (existing?.local_project_id === localProjectId) return project;
    if (existing) {
      throw new WorkerError("PROJECT_ROOT_ALREADY_BOUND", "This folder is already linked to another project.");
    }
    const updatedAt = new Date().toISOString();
    const rootFingerprint = `sha256:${createHash("sha256").update(realRootPath).digest("hex")}`;
    this.insertFolder(localProjectId, absoluteRoot, realRootPath, rootFingerprint, updatedAt);
    if (!project.realRootPath) {
      this.db.prepare(`
        UPDATE local_projects
        SET root_path = ?, real_root_path = ?, root_fingerprint = ?, updated_at = ?
        WHERE local_project_id = ?
      `).run(absoluteRoot, realRootPath, rootFingerprint, updatedAt, localProjectId);
    } else {
      this.db.prepare("UPDATE local_projects SET updated_at = ? WHERE local_project_id = ?")
        .run(updatedAt, localProjectId);
    }
    return this.getAny(localProjectId)!;
  }

  removeFolder(localProjectId: string, folderId: string): LocalProject {
    const project = this.getAny(localProjectId);
    if (!project) throw new WorkerError("PROJECT_NOT_FOUND", "Project not found.");
    const folder = project.folders.find((item) => item.folderId === folderId);
    if (!folder) throw new WorkerError("PROJECT_FOLDER_NOT_FOUND", "Project folder not found.");
    this.db.prepare("DELETE FROM local_project_folders WHERE local_project_id = ? AND folder_id = ?")
      .run(localProjectId, folderId);
    const updatedAt = new Date().toISOString();
    if (folder.primary) {
      const next = this.db.prepare(`
        SELECT * FROM local_project_folders WHERE local_project_id = ? ORDER BY created_at ASC LIMIT 1
      `).get(localProjectId) as ProjectFolderRow | undefined;
      this.db.prepare(`
        UPDATE local_projects SET root_path = ?, real_root_path = ?, root_fingerprint = ?, updated_at = ?
        WHERE local_project_id = ?
      `).run(next?.root_path ?? "", next?.real_root_path ?? "", next?.root_fingerprint ?? "", updatedAt, localProjectId);
    } else {
      this.db.prepare("UPDATE local_projects SET updated_at = ? WHERE local_project_id = ?")
        .run(updatedAt, localProjectId);
    }
    return this.getAny(localProjectId)!;
  }

  delete(localProjectId: string): boolean {
    this.db.prepare("DELETE FROM local_project_folders WHERE local_project_id = ?").run(localProjectId);
    return this.db.prepare(
      "DELETE FROM local_projects WHERE local_project_id = ?"
    ).run(localProjectId).changes > 0;
  }

  get(localProjectId: string): LocalProject | null {
    const project = this.getAny(localProjectId);
    return project?.folderStatus === "available" ? project : null;
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
      folderStatus: inspectFolder(row.real_root_path),
      rootPath: row.root_path,
      realRootPath: row.real_root_path,
      rootFingerprint: row.root_fingerprint,
      folders: this.listFolders(row.local_project_id, row.real_root_path),
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

  private insertFolder(localProjectId: string, rootPath: string, realRootPath: string, rootFingerprint: string, createdAt: string): void {
    this.db.prepare(`
      INSERT INTO local_project_folders (
        local_project_id, folder_id, root_path, real_root_path, root_fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(localProjectId, rootFingerprint, rootPath, realRootPath, rootFingerprint, createdAt);
  }

  private listFolders(localProjectId: string, primaryRealRootPath: string): LocalProjectFolder[] {
    const rows = this.db.prepare(`
      SELECT * FROM local_project_folders WHERE local_project_id = ? ORDER BY created_at ASC
    `).all(localProjectId) as ProjectFolderRow[];
    return rows.map((row) => {
      const status = inspectFolder(row.real_root_path);
      return {
        folderId: row.folder_id,
        name: basename(row.root_path),
        rootPath: row.root_path,
        realRootPath: row.real_root_path,
        rootFingerprint: row.root_fingerprint,
        status: status === "unlinked" ? "missing" : status,
        primary: row.real_root_path === primaryRealRootPath
      };
    });
  }
}

function inspectFolder(realRootPath: string): LocalProject["folderStatus"] {
  if (!realRootPath) return "unlinked";
  try {
    if (!statSync(realRootPath).isDirectory()) return "missing";
  } catch (error) {
    return isMissingPathError(error) ? "missing" : "unavailable";
  }
  try {
    accessSync(realRootPath, constants.R_OK);
    return "available";
  } catch {
    return "unavailable";
  }
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
