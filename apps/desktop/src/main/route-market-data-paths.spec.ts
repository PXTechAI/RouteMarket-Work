import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrateLegacyRouteMarketDeviceData,
  migrateLegacyRouteMarketData,
  migrateUnscopedRouteMarketData,
  routeMarketDataPaths,
  routeMarketDataScopePaths
} from "./route-market-data-paths";

describe("RouteMarket durable data paths", () => {
  it("keeps user-owned state below ~/.routemarket", () => {
    const paths = routeMarketDataPaths(join("C:\\", "Users", "someone"));
    expect(paths.root).toBe(join("C:\\", "Users", "someone", ".routemarket"));
    expect(paths.settings).toBe(join(paths.root, "device", "settings.json"));
    expect(paths.credentials).toBe(join(paths.root, "auth", "active-credentials.json"));
    expect(paths.skillSigningKey).toBe(
      join(paths.root, "device", "local-skill-signing-key.json")
    );
  });

  it("isolates work state by account and space without exposing raw identifiers", () => {
    const paths = routeMarketDataPaths(join("C:\\", "Users", "someone"));
    const personal = routeMarketDataScopePaths(paths, {
      accountId: "account_secret@example.test",
      spaceId: "personal:account_secret@example.test"
    });
    const team = routeMarketDataScopePaths(paths, {
      accountId: "account_secret@example.test",
      spaceId: "team_design"
    });
    const otherAccount = routeMarketDataScopePaths(paths, {
      accountId: "account_other",
      spaceId: "team_design"
    });
    expect(personal.root).not.toContain("account_secret@example.test");
    expect(personal.root).not.toBe(team.root);
    expect(team.root).not.toBe(otherAccount.root);
    expect(personal.database).toBe(join(personal.root, "work.db"));
    expect(routeMarketDataScopePaths(paths).accountKey).toBe("guest");
  });

  it("copies legacy state, preserves the source, and never overwrites destination data", async () => {
    const parent = await mkdtemp(join(tmpdir(), "routemarket-data-migration-"));
    const legacy = join(parent, "legacy-worker");
    const destination = join(parent, ".routemarket");
    await Promise.all([mkdir(legacy), mkdir(destination)]);
    await writeFile(join(legacy, "work.db"), "legacy database");
    await writeFile(join(legacy, "work.db-wal"), "legacy wal");
    await writeFile(join(legacy, "device-credentials.json"), "legacy credentials");
    await writeFile(join(destination, "work.db"), "current database");

    await expect(migrateLegacyRouteMarketData(legacy, destination)).resolves.toBe(true);
    expect(await readFile(join(destination, "work.db"), "utf8")).toBe("current database");
    await expect(readFile(join(destination, "work.db-wal"), "utf8")).rejects.toThrow();
    expect(await readFile(join(destination, "device-credentials.json"), "utf8")).toBe(
      "legacy credentials"
    );
    expect(await readFile(join(legacy, "device-credentials.json"), "utf8")).toBe(
      "legacy credentials"
    );
    await expect(migrateLegacyRouteMarketData(legacy, destination)).resolves.toBe(false);
  });

  it("moves legacy device files to device/auth layers and claims work data once", async () => {
    const home = await mkdtemp(join(tmpdir(), "routemarket-scoped-migration-"));
    const paths = routeMarketDataPaths(home);
    await mkdir(paths.root, { recursive: true });
    await writeFile(join(paths.root, "settings.json"), "settings");
    await writeFile(join(paths.root, "device-credentials.json"), "credentials");
    await writeFile(join(paths.root, "work.db"), "database");
    await mkdir(join(paths.root, "skill-downloads"));
    await writeFile(join(paths.root, "skill-downloads", "package.zip"), "zip");

    await expect(migrateLegacyRouteMarketDeviceData(paths)).resolves.toBe(true);
    expect(await readFile(paths.settings, "utf8")).toBe("settings");
    expect(await readFile(paths.credentials, "utf8")).toBe("credentials");

    const firstScope = routeMarketDataScopePaths(paths, {
      accountId: "account_a",
      spaceId: "space_a"
    });
    await expect(
      migrateUnscopedRouteMarketData(paths, firstScope.root, firstScope.scopeId)
    ).resolves.toBe(true);
    expect(await readFile(firstScope.database, "utf8")).toBe("database");
    expect(await readFile(join(firstScope.root, "skill-downloads", "package.zip"), "utf8"))
      .toBe("zip");

    const secondScope = routeMarketDataScopePaths(paths, {
      accountId: "account_b",
      spaceId: "space_b"
    });
    await expect(
      migrateUnscopedRouteMarketData(paths, secondScope.root, secondScope.scopeId)
    ).resolves.toBe(false);
    await expect(readFile(secondScope.database, "utf8")).rejects.toThrow();
  });
});
