import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopUsageStore } from "./desktop-usage-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DesktopUsageStore", () => {
  it("stores unified desktop chat and local gateway usage newest first", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-usage-"));
    directories.push(directory);
    const store = new DesktopUsageStore(join(directory, "usage.jsonl"));
    await store.record({
      id: "one",
      source: "desktop_chat",
      kind: "chat",
      providerId: null,
      providerName: "RouteMarket",
      requestedModel: "model-a",
      resolvedModel: "model-a",
      routeId: null,
      status: 200,
      durationMs: 120,
      success: true,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 90,
      cacheCreationInputTokens: null,
      pricingSnapshot: {
        currency: "USD",
        inputUsdPerMillion: 3,
        outputUsdPerMillion: 15,
        cacheReadUsdPerMillion: 0.3,
        cacheWriteUsdPerMillion: 3.75
      },
      estimatedCostUsdMicros: 630,
      createdAt: "2026-08-17T00:00:00.000Z"
    });
    await store.record({
      id: "two",
      source: "local_gateway",
      kind: "responses",
      providerId: "provider-a",
      providerName: "OpenAI",
      requestedModel: "route/a",
      resolvedModel: "model-b",
      routeId: "a",
      status: 429,
      durationMs: 250,
      success: false,
      createdAt: "2026-08-17T00:01:00.000Z"
    });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: "two", source: "local_gateway", kind: "responses" }),
      expect.objectContaining({
        id: "one",
        source: "desktop_chat",
        providerName: "RouteMarket",
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 90,
        cacheCreationInputTokens: null,
        estimatedCostUsdMicros: 630,
        pricingSnapshot: expect.objectContaining({ inputUsdPerMillion: 3, outputUsdPerMillion: 15 })
      })
    ]);
  });

  it("preserves desktop media usage instead of classifying it as gateway traffic", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-usage-media-"));
    directories.push(directory);
    const store = new DesktopUsageStore(join(directory, "usage.jsonl"));
    await store.record({
      id: "media",
      source: "desktop_media",
      kind: "image",
      providerId: null,
      providerName: "RouteMarket",
      requestedModel: "image-model",
      resolvedModel: "image-model",
      routeId: null,
      status: 200,
      durationMs: 320,
      success: true,
      createdAt: "2026-08-17T00:02:00.000Z"
    });

    await expect(store.list(1)).resolves.toEqual([
      expect.objectContaining({ id: "media", source: "desktop_media", kind: "image" })
    ]);
  });

  it("migrates existing gateway-only records when reading", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-usage-legacy-"));
    directories.push(directory);
    const store = new DesktopUsageStore(join(directory, "usage.jsonl"));
    await store.record({
      id: "legacy",
      source: "local_gateway",
      kind: "chat",
      providerId: null,
      providerName: "RouteMarket",
      requestedModel: "model-a",
      resolvedModel: "model-a",
      routeId: null,
      status: 200,
      durationMs: 80,
      success: true,
      createdAt: "2026-08-17T00:00:00.000Z"
    });
    await expect(store.list(1)).resolves.toEqual([
      expect.objectContaining({ source: "local_gateway", kind: "chat" })
    ]);
  });
});
