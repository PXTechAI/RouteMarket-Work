import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearLocalDataOnStartup,
  exportLocalDatabase,
  inspectLocalData,
  recoverLocalDatabase
} from "./local-data-manager";

const cleanups: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanups.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("local data manager", () => {
  it("reports usage and creates a portable SQLite backup", async () => {
    const dataPath = await temporaryDirectory();
    const databasePath = join(dataPath, "work.db");
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE notes (value TEXT); INSERT INTO notes VALUES ('saved');");
    database.close();

    const info = await inspectLocalData(dataPath);
    expect(info).toMatchObject({
      scope: "guest",
      accountName: null,
      spaceName: null,
      storedAccountCount: 0,
      storedSpaceCount: 0
    });
    expect(info.databaseHealth).toBe("healthy");
    expect(info.databaseBytes).toBeGreaterThan(0);
    expect(info.totalBytes).toBeGreaterThanOrEqual(info.databaseBytes);

    const destination = join(dataPath, "backup.sqlite");
    await exportLocalDatabase(dataPath, destination);
    const restored = new DatabaseSync(destination, { readOnly: true });
    expect(restored.prepare("SELECT value FROM notes").get()).toEqual({
      value: "saved"
    });
    restored.close();
  });

  it("preserves a corrupt database and recovers on the next startup", async () => {
    const dataPath = await temporaryDirectory();
    await writeFile(join(dataPath, "work.db"), "not a sqlite database", "utf8");

    await expect(recoverLocalDatabase(dataPath)).resolves.toBe(true);
    const names = await import("node:fs/promises").then(({ readdir }) =>
      readdir(dataPath)
    );
    expect(names.some((name) => name.startsWith("work.db.corrupt-"))).toBe(true);
    expect(await inspectLocalData(dataPath)).toMatchObject({
      databaseHealth: "empty",
      lastRecoveredAt: expect.any(String)
    });
  });

  it("clears data only when the restart marker exists", async () => {
    const root = await temporaryDirectory();
    const dataPath = join(root, "worker");
    const markerPath = join(root, ".clear-local-data");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dataPath, { recursive: true })
    );
    await writeFile(join(dataPath, "work.db"), "data");
    await writeFile(markerPath, "clear");

    await expect(clearLocalDataOnStartup(dataPath, markerPath)).resolves.toBe(true);
    await expect(readFile(join(dataPath, "work.db"))).rejects.toThrow();
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "rm-local-data-"));
  cleanups.push(path);
  return path;
}
