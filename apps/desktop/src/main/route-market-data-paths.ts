import { createHash } from "node:crypto";
import { access, cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type RouteMarketDataPaths = {
  root: string;
  deviceRoot: string;
  authRoot: string;
  accountsRoot: string;
  legacyDatabase: string;
  settings: string;
  credentials: string;
  installationId: string;
  skillSigningKey: string;
  dataScopeIndex: string;
};

export type RouteMarketDataScopeIdentity = {
  accountId?: string | null;
  spaceId?: string | null;
};

export type RouteMarketDataScopePaths = {
  scopeId: string;
  accountKey: string;
  spaceKey: string;
  root: string;
  database: string;
};

const LEGACY_MIGRATION_MARKER = ".legacy-worker-imported-v1";
const UNSCOPED_MIGRATION_MARKER = ".unscoped-work-claimed-v1";
const RESERVED_ROOT_ENTRIES = new Set([
  "accounts",
  "auth",
  "device",
  "device-credentials.json",
  "installation-id",
  "local-skill-signing-key.json",
  "settings.json",
  LEGACY_MIGRATION_MARKER,
  UNSCOPED_MIGRATION_MARKER
]);

export function routeMarketDataPaths(homePath: string): RouteMarketDataPaths {
  const root = join(resolve(homePath), ".routemarket");
  const deviceRoot = join(root, "device");
  const authRoot = join(root, "auth");
  return {
    root,
    deviceRoot,
    authRoot,
    accountsRoot: join(root, "accounts"),
    legacyDatabase: join(root, "work.db"),
    settings: join(deviceRoot, "settings.json"),
    credentials: join(authRoot, "active-credentials.json"),
    installationId: join(deviceRoot, "installation-id"),
    skillSigningKey: join(deviceRoot, "local-skill-signing-key.json"),
    dataScopeIndex: join(deviceRoot, "data-scopes.json")
  };
}

export function routeMarketDataScopePaths(
  paths: RouteMarketDataPaths,
  identity: RouteMarketDataScopeIdentity = {}
): RouteMarketDataScopePaths {
  const accountId = normalizedIdentityPart(identity.accountId);
  const spaceId = normalizedIdentityPart(identity.spaceId);
  const accountKey = accountId ? `account_${identityHash(accountId)}` : "guest";
  const spaceKey = accountId
    ? `space_${identityHash(spaceId ?? `personal:${accountId}`)}`
    : "local";
  const root = join(paths.accountsRoot, accountKey, "spaces", spaceKey);
  return {
    scopeId: identityHash(`${accountKey}:${spaceKey}`),
    accountKey,
    spaceKey,
    root,
    database: join(root, "work.db")
  };
}

/** Copies legacy device-level files into their new locations without deleting old data. */
export async function migrateLegacyRouteMarketDeviceData(
  paths: RouteMarketDataPaths
): Promise<boolean> {
  const migrations = [
    [join(paths.root, "settings.json"), paths.settings],
    [join(paths.root, "device-credentials.json"), paths.credentials],
    [join(paths.root, "installation-id"), paths.installationId],
    [join(paths.root, "local-skill-signing-key.json"), paths.skillSigningKey]
  ] as const;
  const results = await Promise.all(migrations.map(([source, destination]) =>
    copyEntryIfMissing(source, destination)
  ));
  return results.some(Boolean);
}

/**
 * Claims the old unscoped work data for exactly one account/space. The global
 * marker prevents a later account on the same device from inheriting it.
 */
export async function migrateUnscopedRouteMarketData(
  paths: RouteMarketDataPaths,
  destinationPath: string,
  scopeId: string
): Promise<boolean> {
  const marker = join(paths.root, UNSCOPED_MIGRATION_MARKER);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  if (await exists(marker)) return false;
  await mkdir(destinationPath, { recursive: true, mode: 0o700 });

  const entries = await readdir(paths.root, { withFileTypes: true });
  const destinationHasDatabase = await hasDatabase(destinationPath);
  let migrated = false;
  for (const entry of entries) {
    if (RESERVED_ROOT_ENTRIES.has(entry.name)) continue;
    if (destinationHasDatabase && /^work\.db(?:-(?:wal|shm))?$/.test(entry.name)) continue;
    const target = join(destinationPath, entry.name);
    if (await exists(target)) continue;
    migrated = await copyEntryAtomically(join(paths.root, entry.name), target, entry.isDirectory()) || migrated;
  }
  await writeFile(marker, `${scopeId}\n${new Date().toISOString()}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return migrated;
}

/**
 * Copies legacy durable data into ~/.routemarket without deleting the source.
 * Entries that already exist in the destination always win, so an interrupted
 * migration can safely resume on the next launch.
 */
export async function migrateLegacyRouteMarketData(
  legacyPath: string,
  destinationPath: string
): Promise<boolean> {
  const legacy = resolve(legacyPath);
  const destination = resolve(destinationPath);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  if (await exists(join(destination, LEGACY_MIGRATION_MARKER))) return false;
  if (legacy === destination || !(await exists(legacy))) {
    await markLegacyRouteMarketDataImported(destination);
    return false;
  }
  const entries = await readdir(legacy, { withFileTypes: true });
  const destinationHasDatabase = await hasDatabase(destination);
  let migrated = false;

  for (const entry of entries) {
    if (destinationHasDatabase && /^work\.db(?:-(?:wal|shm))?$/.test(entry.name)) continue;
    const target = join(destination, entry.name);
    if (await exists(target)) continue;

    migrated = await copyEntryAtomically(join(legacy, entry.name), target, entry.isDirectory()) || migrated;
  }

  await markLegacyRouteMarketDataImported(destination);
  return migrated;
}

export async function markLegacyRouteMarketDataImported(destinationPath: string): Promise<void> {
  await mkdir(destinationPath, { recursive: true, mode: 0o700 });
  await writeFile(
    join(destinationPath, LEGACY_MIGRATION_MARKER),
    `${new Date().toISOString()}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function hasDatabase(directory: string): Promise<boolean> {
  return Promise.all(["work.db", "work.db-wal", "work.db-shm"]
    .map((name) => exists(join(directory, name))))
    .then((matches) => matches.some(Boolean));
}

async function copyEntryIfMissing(source: string, destination: string): Promise<boolean> {
  if (!(await exists(source)) || await exists(destination)) return false;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  return copyEntryAtomically(source, destination, false);
}

async function copyEntryAtomically(
  source: string,
  destination: string,
  recursive: boolean
): Promise<boolean> {
  const staging = join(
    dirname(destination),
    `.${basename(destination)}-migrating-${process.pid}`
  );
  await rm(staging, { recursive: true, force: true });
  try {
    await cp(source, staging, {
      recursive,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true
    });
    await rename(staging, destination);
    return true;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function normalizedIdentityPart(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function identityHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
