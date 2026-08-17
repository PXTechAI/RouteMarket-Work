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

import { ModelProviderStore } from "./model-provider-store";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "routemarket-model-providers-"));
  directories.push(directory);
  const filePath = join(directory, "model-providers.json");
  return { store: new ModelProviderStore(filePath), filePath };
}

describe("ModelProviderStore", () => {
  it("encrypts keys and synchronizes OpenAI-compatible models", async () => {
    const { store, filePath } = await createStore();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.openai.com/v1/models");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-secret-value");
      return new Response(JSON.stringify({
        data: [
          { id: "gpt-5", display_name: "GPT-5" },
          { id: "text-embedding-3-large" }
        ]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = await store.save({
      name: "OpenAI",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1/",
      apiKey: "sk-secret-value",
      compatibility: "openrouter",
      headers: [{ name: "X-Workspace", value: "desktop" }],
      enabled: true
    });
    const synced = await store.sync(saved.id);

    expect(synced).toMatchObject({ modelCount: 1, baseUrl: "https://api.openai.com/v1", lastError: null });
    expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      headers: expect.objectContaining({
        "HTTP-Referer": "https://routemarket.ai",
        "X-Title": "RouteMarket Work",
        "X-Workspace": "desktop"
      })
    }));
    expect(await store.listModels()).toEqual([
      expect.objectContaining({ displayName: "GPT-5", source: "external", providerName: "OpenAI" })
    ]);
    expect(await readFile(filePath, "utf8")).not.toContain("sk-secret-value");
  });

  it("rejects custom headers that could replace credentials or HTTP framing", async () => {
    const { store } = await createStore();
    await expect(store.save({
      name: "Unsafe gateway",
      protocol: "openai-compatible",
      compatibility: "custom",
      baseUrl: "https://models.example.test/v1",
      apiKey: "safe-key",
      enabled: true,
      headers: [{ name: "Authorization", value: "Bearer attacker-value" }]
    })).rejects.toThrow("managed by RouteMarket");
  });

  it("uses Anthropic headers and preserves the current key while editing", async () => {
    const { store } = await createStore();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/models?limit=1000");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("anthropic-secret");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = await store.save({
      name: "Anthropic",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-secret",
      enabled: true
    });
    await store.save({
      id: saved.id,
      name: "Anthropic Official",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
      enabled: true
    });

    await expect(store.sync(saved.id)).resolves.toMatchObject({ modelCount: 1 });
  });

  it("keeps manually entered models when the provider does not support /models", async () => {
    const { store } = await createStore();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
    ));

    const saved = await store.save({
      name: "Company gateway",
      protocol: "openai-compatible",
      baseUrl: "https://models.example.test/v1",
      apiKey: "company-secret",
      enabled: true,
      models: [{
        id: "company-reasoner",
        displayName: "Company Reasoner",
        source: "manual",
        category: "reasoning",
        supportsTools: true,
        supportsVision: false,
        supportsStream: true,
        supportsReasoningSummary: true
      }]
    });

    await expect(store.sync(saved.id)).rejects.toThrow("Provider request failed");
    await expect(store.listModels()).resolves.toEqual([
      expect.objectContaining({
        displayName: "Company Reasoner",
        category: "reasoning",
        supportsTools: true,
        supportsVision: false,
        supportsReasoningSummary: true
      })
    ]);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        modelCount: 1,
        models: [expect.objectContaining({ id: "company-reasoner", source: "manual" })]
      })
    ]);
  });

  it("merges synchronized models without removing manual entries", async () => {
    const { store } = await createStore();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: [{ id: "remote-chat", display_name: "Remote Chat" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ));
    const saved = await store.save({
      name: "Mixed provider",
      protocol: "openai-compatible",
      baseUrl: "https://mixed.example.test/v1",
      apiKey: "mixed-secret",
      enabled: true,
      models: [{
        id: "manual-chat",
        displayName: "Manual Chat",
        source: "manual",
        category: "chat",
        supportsTools: false,
        supportsVision: true,
        supportsStream: true,
        supportsReasoningSummary: false
      }]
    });

    await expect(store.sync(saved.id)).resolves.toMatchObject({ modelCount: 2 });
    await expect(store.listModels()).resolves.toEqual([
      expect.objectContaining({ displayName: "Manual Chat", supportsVision: true }),
      expect.objectContaining({ displayName: "Remote Chat", supportsTools: false, supportsVision: false })
    ]);
  });
});
