import { createHash, createPublicKey } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import type {
  MarketplaceCatalogItem,
  MarketplaceCatalogResponse
} from "../shared/desktop-api";
import { parseMarketplaceCatalog } from "./marketplace-catalog-client";

export type DevelopmentMarketplaceFixture = {
  item: MarketplaceCatalogItem;
  packagePath: string;
  publisherKeys: Readonly<Record<string, string>>;
};

export async function loadDevelopmentMarketplaceFixture(
  fixturePath: string | undefined,
  enabled: boolean
): Promise<DevelopmentMarketplaceFixture | null> {
  if (!enabled || !fixturePath) return null;
  const absoluteFixturePath = resolve(fixturePath);
  if (!isAbsolute(fixturePath) || extname(absoluteFixturePath).toLocaleLowerCase() !== ".json") {
    throw new Error("Development Marketplace fixture must be an absolute JSON path.");
  }
  const fixtureStat = await lstat(absoluteFixturePath);
  if (fixtureStat.isSymbolicLink() || !fixtureStat.isFile() || fixtureStat.size > 256 * 1024) {
    throw new Error("Development Marketplace fixture file is unsafe.");
  }
  const value = JSON.parse(await readFile(absoluteFixturePath, "utf8")) as unknown;
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.item) || !isRecord(value.publisherKeys)) {
    throw new Error("Development Marketplace fixture is invalid.");
  }
  const catalog = parseMarketplaceCatalog({
    schemaVersion: 1,
    revision: `sha256:${"0".repeat(64)}`,
    items: [value.item]
  });
  const item = catalog.items[0]!;
  if (item.kind !== "plugin" || item.release.distributionSource !== "marketplace") {
    throw new Error("Development Marketplace fixture must contain a downloadable plugin.");
  }
  if (typeof value.packagePath !== "string" || !isAbsolute(value.packagePath) || extname(value.packagePath).toLocaleLowerCase() !== ".zip") {
    throw new Error("Development Marketplace package path must be an absolute ZIP path.");
  }
  const packagePath = resolve(value.packagePath);
  const packageStat = await lstat(packagePath);
  if (packageStat.isSymbolicLink() || !packageStat.isFile() || !packageStat.size || packageStat.size > 32 * 1024 * 1024) {
    throw new Error("Development Marketplace package file is unsafe.");
  }
  const publisherKeys: Record<string, string> = {};
  for (const [keyId, key] of Object.entries(value.publisherKeys)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(keyId) || typeof key !== "string" || key.length > 4096) {
      throw new Error("Development Marketplace publisher key is invalid.");
    }
    const publicKey = createPublicKey(key);
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Development Marketplace publisher key must use Ed25519.");
    publisherKeys[keyId] = key;
  }
  if (!(item.release.signature.keyId in publisherKeys)) {
    throw new Error("Development Marketplace fixture does not include its signing public key.");
  }
  return { item, packagePath, publisherKeys: Object.freeze(publisherKeys) };
}

export function mergeDevelopmentMarketplaceCatalog(
  catalog: MarketplaceCatalogResponse | null,
  fixture: DevelopmentMarketplaceFixture
): MarketplaceCatalogResponse {
  const items = [...(catalog?.items ?? [])];
  if (items.some((item) => item.id === fixture.item.id)) {
    throw new Error(`Duplicate Development Marketplace plugin: ${fixture.item.id}`);
  }
  items.push(structuredClone(fixture.item));
  items.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    revision: `sha256:${createHash("sha256").update(JSON.stringify(items)).digest("hex")}`,
    items
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
