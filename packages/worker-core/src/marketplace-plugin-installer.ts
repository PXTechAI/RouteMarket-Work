import {
  createHash,
  createPublicKey,
  KeyObject,
  randomUUID,
  verify
} from "node:crypto";
import {
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertPluginManifest, type PluginManifest } from "@routemarket/work-protocol";
import JSZip from "jszip";
import { WorkerError } from "./errors";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 512;
const MANIFEST_PATH = ".routemarket-plugin/plugin.json";
const INSTALL_MARKER = ".routemarket-install.json";
const PLUGIN_ID = /^[a-z0-9][a-z0-9.-]{2,127}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;

export type MarketplacePluginRelease = {
  pluginId: string;
  publisher: string;
  version: string;
  minimumHostVersion: string;
  integrity: string;
  signature: {
    algorithm: "ed25519";
    keyId: string;
    value: string;
  };
};

export type MarketplacePluginInstallation = {
  pluginId: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  source: "marketplace" | "local";
  integrity: string;
  signerKeyId: string;
  installedAt: string;
  updatedAt: string;
  enabled: boolean;
  status: "ready" | "missing" | "invalid";
};

export type MarketplacePluginPackage = {
  manifest: PluginManifest;
  rootPath: string;
};

type InstallationRow = {
  plugin_id: string;
  active_version: string;
  publisher: string;
  source: "marketplace" | "local";
  integrity: string;
  signer_key_id: string;
  installed_at: string;
  updated_at: string;
  enabled: number;
};

type ParsedPackage = {
  manifest: PluginManifest;
  files: Array<{ relativePath: string; content: Buffer }>;
};

/**
 * Installs declarative Marketplace packages into one account/space data scope.
 * Publisher keys are supplied by the desktop binary, never by the remote catalog.
 */
export class MarketplacePluginInstaller {
  private readonly db: DatabaseSync;
  private readonly trustedKeys = new Map<string, KeyObject>();

  constructor(
    private readonly scopeRoot: string,
    databasePath: string,
    trustedPublisherKeys: Readonly<Record<string, string | Buffer | KeyObject>>,
    private readonly hostVersion: string
  ) {
    if (!SEMVER.test(hostVersion)) throw new Error("RouteMarket host version must be semantic.");
    for (const [keyId, key] of Object.entries(trustedPublisherKeys)) {
      if (!keyId || keyId.length > 128) throw new Error("Marketplace publisher key ID is invalid.");
      this.trustedKeys.set(keyId, key instanceof KeyObject ? key : createPublicKey(key));
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_plugin_installations (
        plugin_id TEXT PRIMARY KEY,
        active_version TEXT NOT NULL,
        publisher TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'marketplace' CHECK (source IN ('marketplace', 'local')),
        integrity TEXT NOT NULL,
        signer_key_id TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(marketplace_plugin_installations)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "enabled")) {
      this.db.exec("ALTER TABLE marketplace_plugin_installations ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));");
    }
    if (!columns.some((column) => column.name === "source")) {
      this.db.exec("ALTER TABLE marketplace_plugin_installations ADD COLUMN source TEXT NOT NULL DEFAULT 'marketplace' CHECK (source IN ('marketplace', 'local'));");
    }
  }

  close(): void {
    this.db.close();
  }

  async installArchive(
    archive: Buffer,
    release: MarketplacePluginRelease
  ): Promise<MarketplacePluginInstallation> {
    const parsed = await this.inspectValidatedArchive(archive, release);
    const contentDigest = packageContentDigest(parsed.files);
    const packagesRoot = await safePackagesRoot(this.scopeRoot);
    const pluginRoot = resolve(packagesRoot, release.pluginId);
    const target = resolve(pluginRoot, release.version);
    assertInside(packagesRoot, pluginRoot);
    assertInside(pluginRoot, target);
    await ensureSafeDirectory(pluginRoot, packagesRoot);

    const existing = await lstat(target).catch(() => null);
    if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) {
      throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "The existing plugin version path is unsafe.");
    }
    if (existing) {
      await assertInstalledVersion(target, release);
    } else {
      const staging = resolve(pluginRoot, `.install-${randomUUID()}`);
      assertInside(pluginRoot, staging);
      await mkdir(staging, { recursive: false, mode: 0o700 });
      try {
        for (const file of parsed.files) {
          const destination = resolve(staging, file.relativePath);
          assertInside(staging, destination);
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, file.content, { mode: 0o600 });
        }
        await writeFile(resolve(staging, INSTALL_MARKER), JSON.stringify({
          schemaVersion: 1,
          pluginId: release.pluginId,
          version: release.version,
          publisher: release.publisher,
          integrity: release.integrity,
          contentDigest,
          signerKeyId: release.signature.keyId
        }, null, 2), { encoding: "utf8", mode: 0o600 });
        await rename(staging, target);
      } catch (error) {
        await safeRemoveStaging(pluginRoot, staging);
        throw error;
      }
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO marketplace_plugin_installations (
        plugin_id, active_version, publisher, source, integrity, signer_key_id, installed_at, updated_at
      ) VALUES (?, ?, ?, 'marketplace', ?, ?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        active_version = excluded.active_version,
        publisher = excluded.publisher,
        source = excluded.source,
        integrity = excluded.integrity,
        signer_key_id = excluded.signer_key_id,
        updated_at = excluded.updated_at,
        enabled = 1
    `).run(
      release.pluginId,
      release.version,
      release.publisher,
      release.integrity,
      release.signature.keyId,
      now,
      now
    );
    return (await this.list()).find((item) => item.pluginId === release.pluginId)!;
  }

  async inspectLocalDirectory(sourceRoot: string): Promise<{ manifest: PluginManifest; integrity: string }> {
    const parsed = await parseLocalPluginDirectory(sourceRoot);
    assertLocalManifest(parsed.manifest);
    return {
      manifest: structuredClone(parsed.manifest),
      integrity: packageContentDigest(parsed.files)
    };
  }

  async installLocalDirectory(
    sourceRoot: string,
    expectedIntegrity?: string
  ): Promise<MarketplacePluginInstallation> {
    const parsed = await parseLocalPluginDirectory(sourceRoot);
    assertLocalManifest(parsed.manifest);
    const { manifest, files } = parsed;
    const contentDigest = packageContentDigest(files);
    if (expectedIntegrity && contentDigest !== expectedIntegrity) {
      throw new WorkerError(
        "PLUGIN_PACKAGE_INTEGRITY_FAILED",
        "Local plugin contents changed after the permission review. Review the plugin again."
      );
    }
    const packagesRoot = await safePackagesRoot(this.scopeRoot);
    const pluginRoot = resolve(packagesRoot, manifest.id);
    const target = resolve(pluginRoot, manifest.version);
    assertInside(packagesRoot, pluginRoot);
    assertInside(pluginRoot, target);
    await ensureSafeDirectory(pluginRoot, packagesRoot);

    const existing = await lstat(target).catch(() => null);
    if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) {
      throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "The existing plugin version path is unsafe.");
    }
    if (existing) {
      const marker = await readInstallMarker(target);
      if (marker.contentDigest !== contentDigest || marker.signerKeyId !== "local-user-approved") {
        throw new WorkerError(
          "PLUGIN_VERSION_CONFLICT",
          "This local plugin version is already installed with different contents. Increase its version before reinstalling."
        );
      }
      await assertInstalledPackage(target, {
        pluginId: manifest.id,
        publisher: manifest.publisher,
        version: manifest.version,
        integrity: contentDigest,
        signerKeyId: "local-user-approved"
      });
    } else {
      await writeInstalledPackage(pluginRoot, target, files, {
        pluginId: manifest.id,
        publisher: manifest.publisher,
        version: manifest.version,
        integrity: contentDigest,
        signerKeyId: "local-user-approved"
      });
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO marketplace_plugin_installations (
        plugin_id, active_version, publisher, source, integrity, signer_key_id, installed_at, updated_at
      ) VALUES (?, ?, ?, 'local', ?, 'local-user-approved', ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        active_version = excluded.active_version,
        publisher = excluded.publisher,
        source = excluded.source,
        integrity = excluded.integrity,
        signer_key_id = excluded.signer_key_id,
        updated_at = excluded.updated_at,
        enabled = 1
    `).run(manifest.id, manifest.version, manifest.publisher, contentDigest, now, now);
    return (await this.list()).find((item) => item.pluginId === manifest.id)!;
  }

  async inspectArchive(
    archive: Buffer,
    release: MarketplacePluginRelease
  ): Promise<PluginManifest> {
    const parsed = await this.inspectValidatedArchive(archive, release);
    return structuredClone(parsed.manifest);
  }

  private async inspectValidatedArchive(
    archive: Buffer,
    release: MarketplacePluginRelease
  ): Promise<ParsedPackage> {
    this.assertTrustedRelease(release);
    if (!archive.length || archive.length > MAX_ARCHIVE_BYTES) {
      throw new WorkerError(
        "PLUGIN_PACKAGE_TOO_LARGE",
        "Plugin package must be between 1 byte and 32 MB."
      );
    }
    const actualIntegrity = marketplacePluginArchiveDigest(archive);
    if (actualIntegrity !== release.integrity) {
      throw new WorkerError("PLUGIN_PACKAGE_INTEGRITY_FAILED", "Plugin package checksum does not match the signed release.");
    }
    const parsed = await parsePluginArchive(archive);
    assertManifestMatchesRelease(parsed.manifest, release);
    return parsed;
  }

  async list(): Promise<MarketplacePluginInstallation[]> {
    const rows = this.db.prepare(`
      SELECT * FROM marketplace_plugin_installations ORDER BY plugin_id ASC
    `).all() as unknown as InstallationRow[];
    const packagesRoot = await safePackagesRoot(this.scopeRoot);
    return Promise.all(rows.map(async (row) => {
      const target = resolve(packagesRoot, row.plugin_id, row.active_version);
      let status: MarketplacePluginInstallation["status"] = "missing";
      let name = row.plugin_id;
      let description = "";
      try {
        await assertInstalledVersion(target, {
          pluginId: row.plugin_id,
          publisher: row.publisher,
          version: row.active_version,
          minimumHostVersion: "0.0.0",
          integrity: row.integrity,
          signature: { algorithm: "ed25519", keyId: row.signer_key_id, value: "unused" }
        });
        const manifest = JSON.parse(await readFile(resolve(target, MANIFEST_PATH), "utf8")) as unknown;
        assertPluginManifest(manifest);
        assertManifestMatchesInstallation(manifest, {
          pluginId: row.plugin_id,
          name: manifest.name,
          description: manifest.description,
          version: row.active_version,
          publisher: row.publisher,
          source: row.source,
          integrity: row.integrity,
          signerKeyId: row.signer_key_id,
          installedAt: row.installed_at,
          updatedAt: row.updated_at,
          enabled: row.enabled === 1,
          status: "ready"
        });
        name = manifest.name;
        description = manifest.description;
        status = "ready";
      } catch (error) {
        status = await lstat(target).then(() => "invalid" as const, () => "missing" as const);
      }
      return {
        pluginId: row.plugin_id,
        name,
        description,
        version: row.active_version,
        publisher: row.publisher,
        source: row.source,
        integrity: row.integrity,
        signerKeyId: row.signer_key_id,
        installedAt: row.installed_at,
        updatedAt: row.updated_at,
        enabled: row.enabled === 1,
        status
      };
    }));
  }

  async listEnabledManifests(): Promise<PluginManifest[]> {
    return (await this.listEnabledPackages()).map((item) => item.manifest);
  }

  async listEnabledPackages(): Promise<MarketplacePluginPackage[]> {
    const installations = await this.list();
    const ready = installations.filter((item) => item.enabled && item.status === "ready");
    const packagesRoot = await safePackagesRoot(this.scopeRoot);
    return Promise.all(ready.map(async (item) => {
      const rootPath = resolve(packagesRoot, item.pluginId, item.version);
      assertInside(packagesRoot, rootPath);
      const manifestPath = resolve(rootPath, MANIFEST_PATH);
      const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      assertPluginManifest(value);
      assertManifestMatchesInstallation(value, item);
      return { manifest: structuredClone(value), rootPath };
    }));
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<MarketplacePluginInstallation | null> {
    if (!PLUGIN_ID.test(pluginId)) throw new WorkerError("PLUGIN_INPUT_INVALID", "Plugin ID is invalid.");
    const current = (await this.list()).find((item) => item.pluginId === pluginId);
    if (!current) throw new WorkerError("PLUGIN_NOT_INSTALLED", "Plugin is not installed in this account space.");
    if (enabled && current.status !== "ready") {
      throw new WorkerError("PLUGIN_PACKAGE_INVALID", "Modified or missing plugin files cannot be enabled.");
    }
    this.db.prepare(`
      UPDATE marketplace_plugin_installations
      SET enabled = ?, updated_at = ?
      WHERE plugin_id = ?
    `).run(enabled ? 1 : 0, new Date().toISOString(), pluginId);
    return (await this.list()).find((item) => item.pluginId === pluginId) ?? null;
  }

  async remove(pluginId: string): Promise<{ removed: true }> {
    if (!PLUGIN_ID.test(pluginId)) throw new WorkerError("PLUGIN_INPUT_INVALID", "Plugin ID is invalid.");
    const row = this.db.prepare(`SELECT plugin_id FROM marketplace_plugin_installations WHERE plugin_id = ?`)
      .get(pluginId) as { plugin_id: string } | undefined;
    if (!row) throw new WorkerError("PLUGIN_NOT_INSTALLED", "Plugin is not installed in this account space.");
    const packagesRoot = await safePackagesRoot(this.scopeRoot);
    const pluginRoot = resolve(packagesRoot, pluginId);
    assertInside(packagesRoot, pluginRoot);
    const existing = await lstat(pluginRoot).catch(() => null);
    if (existing) await assertSafeDirectoryTree(pluginRoot, packagesRoot);
    const trash = resolve(packagesRoot, `.remove-${randomUUID()}`);
    assertInside(packagesRoot, trash);
    if (existing) await rename(pluginRoot, trash);
    try {
      this.db.prepare("DELETE FROM marketplace_plugin_installations WHERE plugin_id = ?").run(pluginId);
    } catch (error) {
      if (existing) await rename(trash, pluginRoot).catch(() => undefined);
      throw error;
    }
    if (existing) await safeRemoveTrash(packagesRoot, trash);
    return { removed: true };
  }

  assertTrustedRelease(release: MarketplacePluginRelease): void {
    assertRelease(release);
    this.verifyReleaseSignature(release);
    if (compareVersions(this.hostVersion, release.minimumHostVersion) < 0) {
      throw new WorkerError("PLUGIN_HOST_INCOMPATIBLE", "This plugin requires a newer RouteMarket Work version.");
    }
  }

  private verifyReleaseSignature(release: MarketplacePluginRelease): void {
    const key = this.trustedKeys.get(release.signature.keyId);
    if (!key) {
      throw new WorkerError("PLUGIN_PUBLISHER_UNTRUSTED", "Plugin release is not signed by a trusted RouteMarket publisher key.");
    }
    const signature = decodeBase64Signature(release.signature.value);
    if (!verify(null, marketplacePluginSignaturePayload(release), key, signature)) {
      throw new WorkerError("PLUGIN_SIGNATURE_INVALID", "Plugin release signature verification failed.");
    }
  }
}

export function marketplacePluginArchiveDigest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function marketplacePluginSignaturePayload(
  release: Pick<MarketplacePluginRelease, "pluginId" | "publisher" | "version" | "minimumHostVersion" | "integrity">
): Buffer {
  return Buffer.from([
    "routemarket-marketplace-plugin-v1",
    release.pluginId,
    release.publisher,
    release.version,
    release.minimumHostVersion,
    release.integrity,
    ""
  ].join("\n"), "utf8");
}

async function parsePluginArchive(archive: Buffer): Promise<ParsedPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  } catch {
    throw new WorkerError("PLUGIN_PACKAGE_INVALID", "Plugin package is not a valid ZIP archive.");
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (!entries.length || entries.length > MAX_FILES) {
    throw new WorkerError("PLUGIN_PACKAGE_INVALID", `Plugin package must contain between 1 and ${MAX_FILES} files.`);
  }
  for (const entry of entries) assertSafeArchiveEntry(entry);
  const manifestEntries = entries.filter((entry) => entry.name.toLocaleLowerCase().endsWith(`/${MANIFEST_PATH}`) || entry.name.toLocaleLowerCase() === MANIFEST_PATH);
  if (manifestEntries.length !== 1) {
    throw new WorkerError("PLUGIN_PACKAGE_INVALID", `Plugin package must contain exactly one ${MANIFEST_PATH}.`);
  }
  const manifestEntry = manifestEntries[0]!;
  const root = manifestEntry.name.slice(0, -MANIFEST_PATH.length);
  if (entries.some((entry) => root && !entry.name.startsWith(root))) {
    throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "All plugin package files must share the manifest directory.");
  }

  const files: ParsedPackage["files"] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const content = await entry.async("nodebuffer");
    totalBytes += content.length;
    if (content.length > MAX_FILE_BYTES || totalBytes > MAX_EXPANDED_BYTES) {
      throw new WorkerError("PLUGIN_PACKAGE_TOO_LARGE", "Plugin package expands beyond the allowed size.");
    }
    const relativePath = root ? entry.name.slice(root.length) : entry.name;
    assertSafeRelativePath(relativePath);
    if (relativePath === INSTALL_MARKER) {
      throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin package contains a reserved installation record.");
    }
    files.push({ relativePath, content });
  }
  const manifestBytes = files.find((file) => file.relativePath === MANIFEST_PATH)?.content;
  if (!manifestBytes || manifestBytes.includes(0)) {
    throw new WorkerError("PLUGIN_PACKAGE_INVALID", "Plugin manifest is missing or is not valid text.");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
    assertPluginManifest(manifest);
  } catch (error) {
    throw new WorkerError("PLUGIN_PACKAGE_INVALID", error instanceof Error ? error.message : "Plugin manifest is invalid.");
  }
  return { manifest, files };
}

async function parseLocalPluginDirectory(sourceRoot: string): Promise<ParsedPackage> {
  if (typeof sourceRoot !== "string" || !sourceRoot.trim()) {
    throw new WorkerError("PLUGIN_INPUT_INVALID", "Local plugin directory is required.");
  }
  const resolvedRoot = resolve(sourceRoot);
  const rootStat = await lstat(resolvedRoot).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Local plugin source must be a regular directory.");
  }
  const canonicalRoot = await realpath(resolvedRoot);
  const files = await collectPackageFiles(canonicalRoot, true);
  const manifestBytes = files.find((file) => file.relativePath === MANIFEST_PATH)?.content;
  if (!manifestBytes || manifestBytes.includes(0)) {
    throw new WorkerError("PLUGIN_PACKAGE_INVALID", `Local plugin must contain ${MANIFEST_PATH}.`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
    assertPluginManifest(manifest);
  } catch (error) {
    throw new WorkerError("PLUGIN_PACKAGE_INVALID", error instanceof Error ? error.message : "Plugin manifest is invalid.");
  }
  return { manifest, files };
}

function assertLocalManifest(manifest: PluginManifest): void {
  if (
    manifest.distribution.source !== "local" ||
    (manifest.kind === "desktop_extension"
      ? manifest.distribution.packageFormat !== "desktop-extension"
      : manifest.distribution.packageFormat !== "declarative") ||
    (manifest.kind !== "declarative_plugin" && manifest.kind !== "desktop_extension")
  ) {
    throw new WorkerError("PLUGIN_PACKAGE_IDENTITY_MISMATCH", "Local plugin manifest must declare a supported local package.");
  }
}

function assertManifestMatchesInstallation(
  manifest: PluginManifest,
  installation: MarketplacePluginInstallation
): void {
  if (
    manifest.id !== installation.pluginId ||
    manifest.publisher !== installation.publisher ||
    manifest.version !== installation.version ||
    manifest.distribution.source !== installation.source
  ) {
    throw new WorkerError("PLUGIN_PACKAGE_IDENTITY_MISMATCH", "Installed plugin manifest does not match its installation record.");
  }
  if (installation.source === "local") assertLocalManifest(manifest);
}

function assertManifestMatchesRelease(manifest: PluginManifest, release: MarketplacePluginRelease): void {
  if (
    manifest.id !== release.pluginId ||
    manifest.publisher !== release.publisher ||
    manifest.version !== release.version ||
    manifest.distribution.source !== "marketplace" ||
    (manifest.kind === "desktop_extension"
      ? manifest.distribution.packageFormat !== "desktop-extension"
      : manifest.distribution.packageFormat !== "declarative") ||
    (manifest.kind !== "declarative_plugin" && manifest.kind !== "desktop_extension")
  ) {
    throw new WorkerError("PLUGIN_PACKAGE_IDENTITY_MISMATCH", "Plugin manifest does not match the signed Marketplace release.");
  }
}

function assertRelease(release: MarketplacePluginRelease): void {
  if (
    !PLUGIN_ID.test(release.pluginId) ||
    !release.publisher.trim() || release.publisher.length > 128 ||
    !SEMVER.test(release.version) ||
    !SEMVER.test(release.minimumHostVersion) ||
    !/^sha256:[a-f0-9]{64}$/.test(release.integrity) ||
    release.signature.algorithm !== "ed25519" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(release.signature.keyId)
  ) {
    throw new WorkerError("PLUGIN_RELEASE_INVALID", "Marketplace plugin release metadata is invalid.");
  }
}

function decodeBase64Signature(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new WorkerError("PLUGIN_SIGNATURE_INVALID", "Plugin release signature is not valid base64.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new WorkerError("PLUGIN_SIGNATURE_INVALID", "Plugin release signature has an invalid encoding.");
  }
  return decoded;
}

function assertSafeArchiveEntry(entry: JSZip.JSZipObject): void {
  const originalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
  assertSafeRelativePath(originalName ?? entry.name);
  const permissions = typeof entry.unixPermissions === "number" ? entry.unixPermissions : 0;
  if ((permissions & 0o170000) === 0o120000) {
    throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin package cannot contain symbolic links.");
  }
}

function assertSafeRelativePath(value: string): void {
  if (
    !value || value.includes("\0") || value.includes("\\") || value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin package contains an unsafe path.");
  }
}

async function safePackagesRoot(scopeRoot: string): Promise<string> {
  const scope = resolve(scopeRoot);
  await ensureSafeDirectory(scope);
  const canonicalScope = await realpath(scope);
  const pluginsRoot = resolve(scope, "plugins");
  const packagesRoot = resolve(pluginsRoot, "packages");
  await ensureSafeDirectory(pluginsRoot, scope);
  await ensureSafeDirectory(packagesRoot, pluginsRoot);
  const canonical = await realpath(packagesRoot);
  // Windows realpath can expand an 8.3 segment (for example RUNNER~1) or
  // normalize path casing. Compare two canonical paths so the same directory
  // cannot be mistaken for a traversal while still rejecting a real escape.
  assertInside(canonicalScope, canonical);
  return canonical;
}

async function ensureSafeDirectory(path: string, parent?: string): Promise<void> {
  if (parent) assertInside(parent, path);
  const existing = await lstat(path).catch(() => null);
  if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) {
    throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin installation directory is unsafe.");
  }
  if (!existing) await mkdir(path, { recursive: false, mode: 0o700 });
}

function assertInside(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin package path escaped its installation directory.");
  }
}

async function safeRemoveStaging(pluginRoot: string, staging: string): Promise<void> {
  assertInside(pluginRoot, staging);
  if (!/^\.install-[0-9a-f-]{36}$/.test(relative(pluginRoot, staging))) return;
  const stat = await lstat(staging).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
  await rm(staging, { recursive: true, force: false }).catch(() => undefined);
}

async function safeRemoveTrash(packagesRoot: string, trash: string): Promise<void> {
  assertInside(packagesRoot, trash);
  if (!/^\.remove-[0-9a-f-]{36}$/.test(relative(packagesRoot, trash))) return;
  await assertSafeDirectoryTree(trash, packagesRoot);
  await rm(trash, { recursive: true, force: false });
}

async function assertSafeDirectoryTree(root: string, parent: string): Promise<void> {
  assertInside(parent, root);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin installation directory is unsafe.");
  }
  const pending = [root];
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      entries += 1;
      if (entries > MAX_FILES * 4) throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin installation contains too many entries.");
      const absolutePath = resolve(directory, entry.name);
      assertInside(root, absolutePath);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Plugin installation contains an unsafe filesystem entry.");
      }
      if (entry.isDirectory()) pending.push(absolutePath);
    }
  }
}

async function assertInstalledVersion(target: string, release: MarketplacePluginRelease): Promise<void> {
  await assertInstalledPackage(target, {
    pluginId: release.pluginId,
    publisher: release.publisher,
    version: release.version,
    integrity: release.integrity,
    signerKeyId: release.signature.keyId
  });
}

type InstallIdentity = {
  pluginId: string;
  publisher: string;
  version: string;
  integrity: string;
  signerKeyId: string;
};

async function readInstallMarker(target: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(target, INSTALL_MARKER), "utf8")) as Record<string, unknown>;
}

async function assertInstalledPackage(target: string, identity: InstallIdentity): Promise<void> {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Plugin version directory is invalid.");
  const marker = await readInstallMarker(target);
  if (
    marker.schemaVersion !== 1 ||
    marker.pluginId !== identity.pluginId ||
    marker.version !== identity.version ||
    marker.publisher !== identity.publisher ||
    marker.integrity !== identity.integrity ||
    marker.signerKeyId !== identity.signerKeyId ||
    typeof marker.contentDigest !== "string"
  ) throw new Error("Plugin installation record does not match its release.");
  const files = await collectInstalledFiles(target);
  if (packageContentDigest(files) !== marker.contentDigest) {
    throw new Error("Installed plugin contents were modified.");
  }
}

async function writeInstalledPackage(
  pluginRoot: string,
  target: string,
  files: ParsedPackage["files"],
  identity: InstallIdentity
): Promise<void> {
  const staging = resolve(pluginRoot, `.install-${randomUUID()}`);
  assertInside(pluginRoot, staging);
  await mkdir(staging, { recursive: false, mode: 0o700 });
  try {
    for (const file of files) {
      const destination = resolve(staging, file.relativePath);
      assertInside(staging, destination);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.content, { mode: 0o600 });
    }
    await writeFile(resolve(staging, INSTALL_MARKER), JSON.stringify({
      schemaVersion: 1,
      ...identity,
      contentDigest: packageContentDigest(files)
    }, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(staging, target);
  } catch (error) {
    await safeRemoveStaging(pluginRoot, staging);
    throw error;
  }
}

function packageContentDigest(files: Array<{ relativePath: string; content: Buffer }>): string {
  const digest = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    digest.update(JSON.stringify([file.relativePath, file.content.byteLength]));
    digest.update("\0");
    digest.update(file.content);
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

async function collectInstalledFiles(root: string): Promise<Array<{ relativePath: string; content: Buffer }>> {
  return collectPackageFiles(root, false);
}

async function collectPackageFiles(
  root: string,
  rejectInstallMarker: boolean
): Promise<Array<{ relativePath: string; content: Buffer }>> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  const pending = [root];
  let totalBytes = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const absolutePath = resolve(directory, entry.name);
      assertInside(root, absolutePath);
      if (entry.isSymbolicLink()) throw new Error("Installed plugin contains a symbolic link.");
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) throw new Error("Installed plugin contains an unsupported file type.");
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (relativePath === INSTALL_MARKER) {
        if (rejectInstallMarker) {
          throw new WorkerError("PLUGIN_PACKAGE_UNSAFE", "Local plugin contains a reserved installation record.");
        }
        continue;
      }
      assertSafeRelativePath(relativePath);
      const content = await readFile(absolutePath);
      totalBytes += content.byteLength;
      if (content.byteLength > MAX_FILE_BYTES || totalBytes > MAX_EXPANDED_BYTES || files.length >= MAX_FILES) {
        throw new Error("Installed plugin contents exceed safety limits.");
      }
      files.push({ relativePath, content });
    }
  }
  if (!files.length) throw new Error("Installed plugin has no package contents.");
  return files;
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, prerelease] = value.split("-", 2);
    return { parts: core!.split(".").map(Number), prerelease: prerelease ?? null };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = a.parts[index]! - b.parts[index]!;
    if (difference) return difference;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}
