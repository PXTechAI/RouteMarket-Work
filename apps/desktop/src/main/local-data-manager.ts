import { DatabaseSync, backup } from "node:sqlite";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LocalDataInfo } from "../shared/desktop-api";

const RECOVERY_RECORD = "last-database-recovery.json";

export async function inspectLocalData(
  dataPath: string,
  context: {
    scope: LocalDataInfo["scope"];
    accountName: string | null;
    spaceName: string | null;
    accountsRoot: string;
  } = {
    scope: "guest",
    accountName: null,
    spaceName: null,
    accountsRoot: dataPath
  }
): Promise<LocalDataInfo> {
  const databasePath = join(dataPath, "work.db");
  const [totalBytes, databaseBytes, recovery, scopeSummary] = await Promise.all([
    localDataDirectorySize(dataPath),
    fileSize(databasePath),
    readRecoveryRecord(dataPath),
    inspectStoredScopes(context.accountsRoot)
  ]);
  return {
    dataPath,
    scope: context.scope,
    accountName: context.accountName,
    spaceName: context.spaceName,
    storedAccountCount: scopeSummary.accountCount,
    storedSpaceCount: scopeSummary.spaceCount,
    allScopesBytes: scopeSummary.totalBytes,
    totalBytes,
    databaseBytes,
    databaseHealth: await databaseHealth(databasePath),
    lastRecoveredAt: recovery?.recoveredAt ?? null
  };
}

async function inspectStoredScopes(accountsRoot: string): Promise<{
  accountCount: number;
  spaceCount: number;
  totalBytes: number;
}> {
  if (!(await exists(accountsRoot))) return { accountCount: 0, spaceCount: 0, totalBytes: 0 };
  const accounts = (await readdir(accountsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory());
  const spaceCounts = await Promise.all(accounts.map(async (account) => {
    const spacesPath = join(accountsRoot, account.name, "spaces");
    if (!(await exists(spacesPath))) return 0;
    return (await readdir(spacesPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).length;
  }));
  return {
    accountCount: accounts.filter((entry) => entry.name !== "guest").length,
    spaceCount: spaceCounts.reduce((total, count) => total + count, 0),
    totalBytes: await localDataDirectorySize(accountsRoot)
  };
}

export async function exportLocalDatabase(
  dataPath: string,
  destinationPath: string
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  await rm(destinationPath, { force: true });
  const source = new DatabaseSync(join(dataPath, "work.db"), {
    readOnly: true
  });
  try {
    await backup(source, destinationPath);
  } finally {
    source.close();
  }
}

export async function recoverLocalDatabase(
  dataPath: string
): Promise<boolean> {
  const databasePath = join(dataPath, "work.db");
  if (!(await exists(databasePath))) return false;
  if (await databaseHealth(databasePath) === "healthy") return false;

  const recoveredAt = new Date().toISOString();
  const suffix = `.corrupt-${recoveredAt.replaceAll(/[:.]/g, "-")}`;
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (await exists(path)) await rename(path, `${path}${suffix}`);
  }
  await writeFile(
    join(dataPath, RECOVERY_RECORD),
    JSON.stringify({ recoveredAt }, null, 2),
    "utf8"
  );
  return true;
}

export async function clearLocalDataOnStartup(
  dataPath: string,
  markerPath: string
): Promise<boolean> {
  if (!(await exists(markerPath))) return false;
  await rm(dataPath, { recursive: true, force: true });
  await rm(markerPath, { force: true });
  return true;
}

async function databaseHealth(
  databasePath: string
): Promise<LocalDataInfo["databaseHealth"]> {
  if (!(await exists(databasePath))) return "empty";
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const result = database.prepare("PRAGMA quick_check").get() as
      | Record<string, unknown>
      | undefined;
    return Object.values(result ?? {})[0] === "ok" ? "healthy" : "corrupt";
  } catch {
    return "corrupt";
  } finally {
    database?.close();
  }
}

export async function localDataDirectorySize(path: string): Promise<number> {
  if (!(await exists(path))) return 0;
  const entries = await readdir(path, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return localDataDirectorySize(entryPath);
    if (!entry.isFile()) return 0;
    return fileSize(entryPath);
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function readRecoveryRecord(
  dataPath: string
): Promise<{ recoveredAt?: string } | null> {
  try {
    return JSON.parse(
      await readFile(join(dataPath, RECOVERY_RECORD), "utf8")
    ) as { recoveredAt?: string };
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}
