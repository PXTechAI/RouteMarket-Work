import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import { WorkerError } from "./errors";
import {
  inspectProjectSkillPackage,
  type ProjectSkillPackageIdentity
} from "./local-skill-package";
import { loadProjectContext } from "./project-context";
import { ProjectRegistry } from "./project-registry";

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 256;
const SKILL_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;

type ReceiptRow = {
  local_project_id: string;
  skill_id: string;
  version: string;
  package_digest: string;
  source_kind: string;
  source_label: string;
  publisher_fingerprint: string | null;
  installed_at: string;
  updated_at: string;
};

export type LocalSkillInstallReceipt = {
  localProjectId: string;
  skillId: string;
  name: string;
  description: string;
  version: string;
  packageDigest: string;
  currentPackageDigest: string | null;
  source: "local_archive" | "web_library" | "local_directory";
  sourceLabel: string;
  publisherFingerprint: string | null;
  installedAt: string | null;
  updatedAt: string | null;
  status: "ready" | "modified" | "missing" | "invalid";
  managed: boolean;
  relativePath: string;
  permissions: string[];
  operations: string[];
};

export type LocalSkillImportKind = "archive" | "directory" | "markdown";

type ParsedSkillPackage = {
  skillId: string;
  version: string;
  files: Array<{ relativePath: string; content: Buffer }>;
};

export class LocalSkillInstaller {
  private readonly db: DatabaseSync;

  constructor(
    private readonly registry: ProjectRegistry,
    databasePath: string
  ) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_skill_install_receipts (
        local_project_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        package_digest TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_label TEXT NOT NULL,
        publisher_fingerprint TEXT,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (local_project_id, skill_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  async installArchive(
    localProjectId: string,
    sourcePath: string,
    sourceLabel = basename(sourcePath),
    sourceKind: "local_archive" | "web_library" = "local_archive"
  ): Promise<LocalSkillInstallReceipt> {
    if (extname(sourcePath).toLocaleLowerCase() !== ".zip") {
      throw new WorkerError(
        "SKILL_PACKAGE_INVALID",
        "Choose a .zip Skill package."
      );
    }
    const archive = await readFile(sourcePath);
    if (!archive.length || archive.length > MAX_ARCHIVE_BYTES) {
      throw new WorkerError(
        "SKILL_PACKAGE_TOO_LARGE",
        "Skill package must be between 1 byte and 5 MB."
      );
    }
    const parsed = await parseArchive(archive);
    return this.installParsed(localProjectId, parsed, sourceLabel, sourceKind);
  }

  async installSource(
    localProjectId: string,
    sourcePath: string,
    importKind: LocalSkillImportKind
  ): Promise<LocalSkillInstallReceipt> {
    if (!["archive", "directory", "markdown"].includes(importKind)) {
      throw new WorkerError("SKILL_PACKAGE_INVALID", "Unsupported Skill import source.");
    }
    if (importKind === "archive") {
      return this.installArchive(localProjectId, sourcePath);
    }
    const parsed = importKind === "markdown"
      ? await parseMarkdownFile(sourcePath)
      : await parseSkillDirectory(sourcePath);
    return this.installParsed(
      localProjectId,
      parsed,
      basename(sourcePath),
      "local_directory"
    );
  }

  private async installParsed(
    localProjectId: string,
    parsed: ParsedSkillPackage,
    sourceLabel: string,
    sourceKind: "local_archive" | "web_library" | "local_directory"
  ): Promise<LocalSkillInstallReceipt> {
    const project = this.registry.get(localProjectId);
    if (!project) {
      throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
    }
    const skillsRoot = await safeSkillsRoot(project.realRootPath);
    const target = resolve(skillsRoot, parsed.skillId);
    assertInside(skillsRoot, target);
    const temporary = resolve(skillsRoot, `.install-${randomUUID()}`);
    const backup = resolve(skillsRoot, `.backup-${randomUUID()}`);
    assertInside(skillsRoot, temporary);
    assertInside(skillsRoot, backup);

    await mkdir(temporary, { recursive: false });
    let replacedExisting = false;
    try {
      for (const file of parsed.files) {
        const destination = resolve(temporary, file.relativePath);
        assertInside(temporary, destination);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, { mode: 0o600 });
      }
      const existing = await lstat(target).catch(() => null);
      if (existing?.isSymbolicLink()) {
        throw new WorkerError(
          "SKILL_PACKAGE_UNSAFE",
          "The existing Skill installation is a symbolic link."
        );
      }
      if (existing) {
        await rename(target, backup);
        replacedExisting = true;
      }
      try {
        await rename(temporary, target);
      } catch (error) {
        if (replacedExisting) await rename(backup, target).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    let identity: ProjectSkillPackageIdentity;
    try {
      identity = await inspectProjectSkillPackage(
        this.registry,
        localProjectId,
        parsed.skillId
      );
      if (identity.version !== parsed.version) {
        throw new WorkerError(
          "SKILL_PACKAGE_INVALID",
          "Installed Skill version does not match its package metadata."
        );
      }
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
      if (replacedExisting) {
        await rename(backup, target).catch(() => undefined);
      }
      throw error;
    }
    if (replacedExisting) await rm(backup, { recursive: true, force: true });
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO local_skill_install_receipts (
        local_project_id, skill_id, version, package_digest, source_kind,
        source_label, publisher_fingerprint, installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(local_project_id, skill_id) DO UPDATE SET
        version = excluded.version,
        package_digest = excluded.package_digest,
        source_kind = excluded.source_kind,
        source_label = excluded.source_label,
        publisher_fingerprint = excluded.publisher_fingerprint,
        updated_at = excluded.updated_at
    `).run(
      localProjectId,
      parsed.skillId,
      identity.version,
      identity.packageDigest,
      sourceKind,
      safeSourceLabel(sourceLabel),
      now,
      now
    );
    return (await this.list(localProjectId)).find(
      (receipt) => receipt.skillId === parsed.skillId
    )!;
  }

  async list(localProjectId: string): Promise<LocalSkillInstallReceipt[]> {
    const project = this.registry.get(localProjectId);
    if (!project) {
      throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
    }
    const context = await loadProjectContext(this.registry, localProjectId);
    const rows = this.db.prepare(`
      SELECT * FROM local_skill_install_receipts
      WHERE local_project_id = ?
      ORDER BY skill_id ASC
    `).all(localProjectId) as unknown as ReceiptRow[];
    const receipts = new Map(rows.map((row) => [row.skill_id, row]));
    const items = await Promise.all(context.skills.map(async (skill) => {
      const receipt = receipts.get(skill.id);
      let identity: ProjectSkillPackageIdentity | null = null;
      try {
        identity = await inspectProjectSkillPackage(this.registry, localProjectId, skill.id);
      } catch {
        // The UI receives a stable invalid state, never a local path or file contents.
      }
      receipts.delete(skill.id);
      return mapReceipt(localProjectId, skill, identity, receipt);
    }));
    for (const receipt of receipts.values()) {
      items.push({
        localProjectId,
        skillId: receipt.skill_id,
        name: receipt.skill_id,
        description: "",
        version: receipt.version,
        packageDigest: receipt.package_digest,
        currentPackageDigest: null,
        source: receipt.source_kind === "web_library"
          ? "web_library"
          : receipt.source_kind === "local_directory"
            ? "local_directory"
            : "local_archive",
        sourceLabel: receipt.source_label,
        publisherFingerprint: receipt.publisher_fingerprint,
        installedAt: receipt.installed_at,
        updatedAt: receipt.updated_at,
        status: "missing",
        managed: true,
        relativePath: `.routemarket/skills/${receipt.skill_id}/SKILL.md`,
        permissions: [],
        operations: []
      });
    }
    return items.sort((left, right) => left.name.localeCompare(right.name));
  }

  async remove(
    localProjectId: string,
    skillId: string
  ): Promise<{ removed: true }> {
    if (!SKILL_ID.test(skillId)) {
      throw new WorkerError("SKILL_INPUT_INVALID", "Skill ID is invalid.");
    }
    const receipt = this.db.prepare(`
      SELECT * FROM local_skill_install_receipts
      WHERE local_project_id = ? AND skill_id = ?
    `).get(localProjectId, skillId) as ReceiptRow | undefined;
    if (!receipt) {
      throw new WorkerError(
        "SKILL_NOT_MANAGED",
        "Only Skills installed by RouteMarket Work can be removed here."
      );
    }
    const current = await inspectProjectSkillPackage(
      this.registry,
      localProjectId,
      skillId
    ).catch(() => null);
    if (current && current.packageDigest !== receipt.package_digest) {
      throw new WorkerError(
        "SKILL_PACKAGE_MODIFIED",
        "This Skill was changed locally. Remove it from the project folder manually to avoid losing edits."
      );
    }
    const project = this.registry.get(localProjectId);
    if (!project) {
      throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
    }
    const skillsRoot = await safeSkillsRoot(project.realRootPath);
    const target = resolve(skillsRoot, skillId);
    assertInside(skillsRoot, target);
    const targetStat = await lstat(target).catch(() => null);
    if (targetStat?.isSymbolicLink()) {
      throw new WorkerError("SKILL_PACKAGE_UNSAFE", "Skill installation is a symbolic link.");
    }
    if (targetStat) await rm(target, { recursive: true, force: true });
    this.db.prepare(`
      DELETE FROM local_skill_install_receipts
      WHERE local_project_id = ? AND skill_id = ?
    `).run(localProjectId, skillId);
    return { removed: true };
  }
}

async function parseMarkdownFile(sourcePath: string): Promise<ParsedSkillPackage> {
  const source = await lstat(sourcePath).catch(() => null);
  if (!source?.isFile() || source.isSymbolicLink() || basename(sourcePath) !== "SKILL.md") {
    throw new WorkerError(
      "SKILL_PACKAGE_INVALID",
      "Choose a file named exactly SKILL.md."
    );
  }
  const content = await readFile(sourcePath);
  return parseSkillFiles([{ relativePath: "SKILL.md", content }]);
}

async function parseSkillDirectory(sourcePath: string): Promise<ParsedSkillPackage> {
  const source = await lstat(sourcePath).catch(() => null);
  if (!source?.isDirectory() || source.isSymbolicLink()) {
    throw new WorkerError("SKILL_PACKAGE_INVALID", "Choose a Skill directory.");
  }
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  let totalBytes = 0;
  let entryCount = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_FILES) {
        throw new WorkerError("SKILL_PACKAGE_TOO_LARGE", `Skill directory cannot contain more than ${MAX_FILES} entries.`);
      }
      const absolutePath = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertSafeRelativePath(relativePath);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new WorkerError("SKILL_PACKAGE_UNSAFE", "Skill directory cannot contain symbolic links.");
      }
      if (stats.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new WorkerError("SKILL_PACKAGE_UNSAFE", "Skill directory contains an unsupported file type.");
      }
      if (stats.size > MAX_FILE_BYTES || totalBytes + stats.size > MAX_EXPANDED_BYTES) {
        throw new WorkerError("SKILL_PACKAGE_TOO_LARGE", "Skill directory exceeds the allowed size.");
      }
      const content = await readFile(absolutePath);
      totalBytes += content.length;
      files.push({ relativePath, content });
    }
  };
  await walk(sourcePath, "");
  return parseSkillFiles(files);
}

async function parseArchive(archive: Buffer): Promise<ParsedSkillPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  } catch {
    throw new WorkerError("SKILL_PACKAGE_INVALID", "Skill package is not a valid ZIP archive.");
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (!entries.length || entries.length > MAX_FILES) {
    throw new WorkerError(
      "SKILL_PACKAGE_INVALID",
      `Skill package must contain between 1 and ${MAX_FILES} files.`
    );
  }
  for (const entry of entries) assertSafeArchivePath(entry);
  const skillEntries = entries.filter((entry) => /(^|\/)skill\.md$/i.test(entry.name));
  if (skillEntries.length !== 1) {
    throw new WorkerError(
      "SKILL_PACKAGE_INVALID",
      "Skill package must contain exactly one SKILL.md."
    );
  }
  const root = skillEntries[0]!.name.slice(0, -"SKILL.md".length);
  if (entries.some((entry) => root && !entry.name.startsWith(root))) {
    throw new WorkerError(
      "SKILL_PACKAGE_UNSAFE",
      "All Skill package files must share the SKILL.md directory."
    );
  }
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const content = await entry.async("nodebuffer");
    totalBytes += content.length;
    if (content.length > MAX_FILE_BYTES || totalBytes > MAX_EXPANDED_BYTES) {
      throw new WorkerError(
        "SKILL_PACKAGE_TOO_LARGE",
        "Skill package expands beyond the allowed size."
      );
    }
    const relativePath = root ? entry.name.slice(root.length) : entry.name;
    if (!relativePath) continue;
    assertSafeRelativePath(relativePath);
    files.push({ relativePath, content });
  }
  return parseSkillFiles(files);
}

function parseSkillFiles(
  files: Array<{ relativePath: string; content: Buffer }>
): ParsedSkillPackage {
  if (!files.length || files.length > MAX_FILES) {
    throw new WorkerError(
      "SKILL_PACKAGE_INVALID",
      `Skill package must contain between 1 and ${MAX_FILES} files.`
    );
  }
  let totalBytes = 0;
  for (const file of files) {
    assertSafeRelativePath(file.relativePath);
    totalBytes += file.content.length;
    if (file.content.length > MAX_FILE_BYTES || totalBytes > MAX_EXPANDED_BYTES) {
      throw new WorkerError("SKILL_PACKAGE_TOO_LARGE", "Skill package exceeds the allowed size.");
    }
  }
  const skillMarkdown = files.find(
    (file) => file.relativePath.toLocaleLowerCase() === "skill.md"
  )?.content.toString("utf8") ?? "";
  if (!files.some((file) => file.relativePath === "SKILL.md")) {
    throw new WorkerError(
      "SKILL_PACKAGE_INVALID",
      "The Skill entry file must be named exactly SKILL.md."
    );
  }
  if (skillMarkdown.includes("\0")) {
    throw new WorkerError("SKILL_PACKAGE_INVALID", "SKILL.md must be a text file.");
  }
  const skillId = frontmatterValue(skillMarkdown, "id");
  const version = frontmatterValue(skillMarkdown, "version");
  if (!skillId || !SKILL_ID.test(skillId)) {
    throw new WorkerError(
      "SKILL_PACKAGE_INVALID",
      "SKILL.md must declare a safe id in YAML frontmatter."
    );
  }
  if (!version || !SEMVER.test(version)) {
    throw new WorkerError(
      "SKILL_PACKAGE_INVALID",
      "SKILL.md must declare a semantic version."
    );
  }
  return { skillId, version, files };
}

function assertSafeArchivePath(entry: JSZip.JSZipObject): void {
  const originalName = (entry as JSZip.JSZipObject & {
    unsafeOriginalName?: string;
  }).unsafeOriginalName;
  assertSafeRelativePath(originalName ?? entry.name);
  const permissions = typeof entry.unixPermissions === "number"
    ? entry.unixPermissions
    : 0;
  if ((permissions & 0o170000) === 0o120000) {
    throw new WorkerError(
      "SKILL_PACKAGE_UNSAFE",
      "Skill package cannot contain symbolic links."
    );
  }
}

function assertSafeRelativePath(value: string): void {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new WorkerError("SKILL_PACKAGE_UNSAFE", "Skill package contains an unsafe path.");
  }
}

async function safeSkillsRoot(projectRoot: string): Promise<string> {
  const projectRealRoot = await realpath(projectRoot);
  const routeMarketRoot = resolve(projectRealRoot, ".routemarket");
  const skillsRoot = resolve(routeMarketRoot, "skills");
  assertInside(projectRealRoot, routeMarketRoot);
  assertInside(projectRealRoot, skillsRoot);
  for (const path of [routeMarketRoot, skillsRoot]) {
    const existing = await lstat(path).catch(() => null);
    if (existing?.isSymbolicLink()) {
      throw new WorkerError(
        "SKILL_PACKAGE_UNSAFE",
        "The project Skill directory cannot be a symbolic link."
      );
    }
    if (existing && !existing.isDirectory()) {
      throw new WorkerError(
        "SKILL_PACKAGE_UNSAFE",
        "The project Skill path is not a directory."
      );
    }
    if (!existing) await mkdir(path, { recursive: false });
  }
  const canonical = await realpath(skillsRoot);
  assertInside(projectRealRoot, canonical);
  return canonical;
}

function assertInside(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  if (
    !fromRoot ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`)
  ) {
    throw new WorkerError(
      "SKILL_PACKAGE_UNSAFE",
      "Skill package path escaped its project directory."
    );
  }
}

function frontmatterValue(markdown: string, key: string): string | null {
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const value = frontmatter?.[1]
    ?.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"))?.[1]
    ?.trim();
  return value || null;
}

function safeSourceLabel(value: string): string {
  const label = basename(value.trim()).replace(/[\r\n\0]/g, "").slice(0, 200);
  return label || "downloaded-skill.zip";
}

function mapReceipt(
  localProjectId: string,
  skill: { id: string; name: string; description: string; relativePath: string },
  identity: ProjectSkillPackageIdentity | null,
  receipt: ReceiptRow | undefined
): LocalSkillInstallReceipt {
  const currentDigest = identity?.packageDigest ?? null;
  return {
    localProjectId,
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    version: identity?.version ?? receipt?.version ?? "unknown",
    packageDigest: receipt?.package_digest ?? currentDigest ?? "",
    currentPackageDigest: currentDigest,
    source: receipt
      ? receipt.source_kind === "web_library"
        ? "web_library"
        : receipt.source_kind === "local_directory"
          ? "local_directory"
          : "local_archive"
      : "local_directory",
    sourceLabel: receipt?.source_label ?? "Project folder",
    publisherFingerprint: receipt?.publisher_fingerprint ?? null,
    installedAt: receipt?.installed_at ?? null,
    updatedAt: receipt?.updated_at ?? null,
    status: !identity
      ? "invalid"
      : receipt && receipt.package_digest !== identity.packageDigest
        ? "modified"
        : "ready",
    managed: Boolean(receipt),
    relativePath: skill.relativePath,
    permissions: identity?.permissions ?? [],
    operations: identity?.operations ?? []
  };
}

export function archiveDigest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
