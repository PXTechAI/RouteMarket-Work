import { describe, expect, it, vi } from "vitest";
import { MarketplaceCatalogClient, parseMarketplaceCatalog } from "./marketplace-catalog-client";
import { RouteMarketApiClient } from "./routemarket-api-client";

const revision = `sha256:${"a".repeat(64)}`;

describe("MarketplaceCatalogClient", () => {
  it("loads the public catalog through the shared RouteMarket transport", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      revision,
      items: [bundledItem]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = new MarketplaceCatalogClient(new RouteMarketApiClient({
      baseUrl: "https://api.example.test",
      appVersion: "0.2.0",
      fetchImpl
    }));

    const catalog = await client.list();

    expect(catalog.items[0]?.id).toBe("ai.routemarket.spreadsheet");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/api/app/v1/marketplace/catalog",
      expect.objectContaining({ headers: expect.objectContaining({ "X-RouteMarket-Client": "desktop" }) })
    );
  });

  it("accepts Agent and MCP capability entries from the shared Marketplace catalog", () => {
    const catalog = parseMarketplaceCatalog({
      schemaVersion: 1,
      revision,
      items: [
        { ...bundledItem, id: "ai.example.agent", slug: "agent", kind: "agent", acquisitionMode: "copy" },
        { ...bundledItem, id: "ai.example.mcp", slug: "mcp", kind: "mcp", acquisitionMode: "install" }
      ]
    });

    expect(catalog.items.map((item) => item.kind)).toEqual(["agent", "mcp"]);
  });

  it("rejects unsigned or insecure marketplace releases", () => {
    expect(() => parseMarketplaceCatalog({
      schemaVersion: 1,
      revision,
      items: [{
        ...bundledItem,
        release: {
          distributionSource: "marketplace",
          version: "1.0.0",
          minimumHostVersion: "0.2.0",
          packageUrl: "http://downloads.example.test/plugin.zip",
          integrity: revision
        }
      }]
    })).toThrow();
  });

  it("downloads packages without forwarding API credentials and enforces the byte limit", async () => {
    const packageFetch = vi.fn<typeof fetch>(async () => new Response(Buffer.from("signed zip"), {
      status: 200,
      headers: { "Content-Length": "10" }
    }));
    const client = new MarketplaceCatalogClient(new RouteMarketApiClient({
      baseUrl: "https://api.example.test",
      appVersion: "0.2.0",
      fetchImpl: vi.fn()
    }), packageFetch);

    await expect(client.downloadPluginPackage(marketplaceItem)).resolves.toEqual(Buffer.from("signed zip"));
    expect(packageFetch).toHaveBeenCalledWith(
      "https://downloads.example.test/tables.zip",
      expect.objectContaining({
        redirect: "manual",
        headers: { Accept: "application/zip, application/octet-stream" }
      })
    );
    expect(packageFetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");

    const oversized = new MarketplaceCatalogClient(new RouteMarketApiClient({
      baseUrl: "https://api.example.test",
      appVersion: "0.2.0",
      fetchImpl: vi.fn()
    }), vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "Content-Length": String(33 * 1024 * 1024) }
    })));
    await expect(oversized.downloadPluginPackage(marketplaceItem)).rejects.toThrow("larger than 32 MB");
  });

  it("rejects local-network package URLs before making a request", async () => {
    const packageFetch = vi.fn<typeof fetch>();
    const client = new MarketplaceCatalogClient(new RouteMarketApiClient({
      baseUrl: "https://api.example.test",
      appVersion: "0.2.0",
      fetchImpl: vi.fn()
    }), packageFetch);
    await expect(client.downloadPluginPackage({
      ...marketplaceItem,
      release: { ...marketplaceItem.release, packageUrl: "https://127.0.0.1/plugin.zip" }
    })).rejects.toThrow("local network");
    expect(packageFetch).not.toHaveBeenCalled();
  });
});

const bundledItem = {
  id: "ai.routemarket.spreadsheet",
  slug: "spreadsheet",
  kind: "plugin",
  publisher: "PXTechAI",
  name: "RouteMarket Spreadsheet",
  description: "Spreadsheet capabilities.",
  status: "available",
  acquisitionMode: "install",
  release: {
    distributionSource: "bundled",
    version: "0.1.0",
    minimumHostVersion: "0.2.0"
  }
} as const;

const marketplaceItem = {
  ...bundledItem,
  id: "ai.example.tables",
  release: {
    distributionSource: "marketplace" as const,
    version: "1.0.0",
    minimumHostVersion: "0.2.0",
    packageUrl: "https://downloads.example.test/tables.zip",
    integrity: `sha256:${"b".repeat(64)}`,
    signature: {
      algorithm: "ed25519" as const,
      keyId: "example.release.2026-01",
      value: "A".repeat(88)
    }
  }
} as const;
