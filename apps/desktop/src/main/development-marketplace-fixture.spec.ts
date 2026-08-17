import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadDevelopmentMarketplaceFixture,
  mergeDevelopmentMarketplaceCatalog
} from "./development-marketplace-fixture";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("development Marketplace fixture", () => {
  it("loads only in development and merges a signed local package descriptor", async () => {
    const root = await mkdtemp(join(tmpdir(), "rm-marketplace-fixture-"));
    roots.push(root);
    const packagePath = join(root, "plugin.zip");
    const fixturePath = join(root, "fixture.json");
    await writeFile(packagePath, "zip bytes");
    const { publicKey } = generateKeyPairSync("ed25519");
    const key = publicKey.export({ type: "spki", format: "pem" }).toString();
    await writeFile(fixturePath, JSON.stringify({
      schemaVersion: 1,
      packagePath,
      publisherKeys: { "example.release.2026-01": key },
      item: marketplaceItem
    }));

    await expect(loadDevelopmentMarketplaceFixture(fixturePath, false)).resolves.toBeNull();
    const fixture = await loadDevelopmentMarketplaceFixture(fixturePath, true);
    expect(fixture).toMatchObject({ packagePath, item: { id: "ai.example.pdf" } });
    expect(mergeDevelopmentMarketplaceCatalog(null, fixture!).items).toHaveLength(1);
  });
});

const marketplaceItem = {
  id: "ai.example.pdf",
  slug: "example-pdf",
  kind: "plugin",
  publisher: "Example",
  name: "Example PDF",
  description: "PDF extension.",
  status: "available",
  acquisitionMode: "install",
  release: {
    distributionSource: "marketplace",
    version: "1.0.0",
    minimumHostVersion: "0.2.0",
    packageUrl: "https://development.routemarket.invalid/pdf.zip",
    integrity: `sha256:${"a".repeat(64)}`,
    signature: {
      algorithm: "ed25519",
      keyId: "example.release.2026-01",
      value: "A".repeat(88)
    }
  }
};
