import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`),
    decryptString: (value: Buffer) => Buffer.from(
      value.toString().replace(/^encrypted:/, ""),
      "base64"
    ).toString()
  }
}));

import { DataScopeIndex } from "./data-scope-index";
import { routeMarketDataPaths, routeMarketDataScopePaths } from "./route-market-data-paths";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DataScopeIndex", () => {
  it("stores display metadata and browser partitions only inside an encrypted envelope", async () => {
    const home = await mkdtemp(join(tmpdir(), "routemarket-data-scope-index-"));
    directories.push(home);
    const paths = routeMarketDataPaths(home);
    const scope = routeMarketDataScopePaths(paths, { accountId: "account_secret", spaceId: "team_secret" });
    const index = new DataScopeIndex(paths.dataScopeIndex);

    await index.upsert(scope, {
      accountName: "Alice",
      spaceName: "Design Team",
      spaceKind: "team"
    });
    await index.addBrowserPartition(scope.scopeId, `persist:routemarket-${"a".repeat(32)}`);

    expect(await index.list()).toEqual([
      expect.objectContaining({
        scopeId: scope.scopeId,
        accountName: "Alice",
        spaceName: "Design Team",
        browserPartitions: [`persist:routemarket-${"a".repeat(32)}`]
      })
    ]);
    const stored = await readFile(paths.dataScopeIndex, "utf8");
    expect(stored).not.toContain("Alice");
    expect(stored).not.toContain("Design Team");
    expect(stored).not.toContain("account_secret");
  });

  it("rejects invalid partition names and removes one scope without affecting others", async () => {
    const home = await mkdtemp(join(tmpdir(), "routemarket-data-scope-index-"));
    directories.push(home);
    const paths = routeMarketDataPaths(home);
    const first = routeMarketDataScopePaths(paths, { accountId: "a", spaceId: "one" });
    const second = routeMarketDataScopePaths(paths, { accountId: "b", spaceId: "two" });
    const index = new DataScopeIndex(paths.dataScopeIndex);
    await index.upsert(first, { accountName: "A", spaceName: "One", spaceKind: "personal" });
    await index.upsert(second, { accountName: "B", spaceName: "Two", spaceKind: "team" });
    await index.addBrowserPartition(first.scopeId, "persist:unsafe");

    await expect(index.remove(first.scopeId)).resolves.toMatchObject({ scopeId: first.scopeId });
    expect(await index.list()).toHaveLength(1);
    expect((await index.list())[0]?.scopeId).toBe(second.scopeId);
  });
});
