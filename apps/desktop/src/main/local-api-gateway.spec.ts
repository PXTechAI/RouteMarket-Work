import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`),
    decryptString: (value: Buffer) => Buffer.from(value.toString().replace(/^encrypted:/, ""), "base64").toString()
  }
}));

import { LocalApiGateway, publicModelId } from "./local-api-gateway";
import type { RouteMarketApiClient } from "./routemarket-api-client";

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("LocalApiGateway", () => {
  it("applies a custom port and restarts an enabled service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-local-gateway-port-"));
    directories.push(directory);
    const initialPort = await reservePort();
    const customPort = await reservePort();
    const gateway = new LocalApiGateway({
      filePath: join(directory, "gateway.json"),
      listModels: async () => [],
      resolveExternalModel: async () => null,
      getApiClient: () => null
    });
    await gateway.initialize();
    await gateway.update({ enabled: true, port: initialPort });
    const updated = await gateway.update({ port: customPort });

    expect(updated).toMatchObject({
      enabled: true,
      running: true,
      port: customPort,
      baseUrl: `http://127.0.0.1:${customPort}/v1`
    });
    await expect(fetch(`http://127.0.0.1:${customPort}/health`).then((response) => response.json()))
      .resolves.toMatchObject({ status: "ok" });
    await gateway.close();
  });

  it("requires its local token and proxies OpenAI-compatible BYOK models", async () => {
    let upstreamAuthorization = "";
    let upstreamUserAgent = "";
    let upstreamApiKey = "";
    const upstreamPaths: string[] = [];
    const upstream = createServer((request, response) => {
      upstreamAuthorization = request.headers.authorization ?? "";
      upstreamUserAgent = request.headers["user-agent"] ?? "";
      upstreamApiKey = typeof request.headers["x-api-key"] === "string" ? request.headers["x-api-key"] : "";
      upstreamPaths.push(request.url ?? "");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: "chatcmpl_test", choices: [{ message: { role: "assistant", content: "ok" } }] }));
    });
    servers.push(upstream);
    const upstreamPort = await listenRandom(upstream);
    const gatewayPort = await reservePort();
    const directory = await mkdtemp(join(tmpdir(), "routemarket-local-gateway-"));
    directories.push(directory);
    const externalModel = {
      code: "external:provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bW9kZWwtMQ",
      displayName: "Model 1",
      source: "external" as const,
      providerId: "provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      providerName: "Local upstream",
      category: "chat" as const,
      supportsTools: true,
      supportsNativeWebSearch: false,
      supportsVision: false,
      supportsStream: true,
      supportsReasoningSummary: false,
      preferredChatProtocol: null
    };
    const anthropicModel = testExternalModel("provider_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "claude-test");
    const gateway = new LocalApiGateway({
      filePath: join(directory, "gateway.json"),
      listModels: async () => [externalModel, anthropicModel],
      resolveExternalModel: async (code) => ({
        provider: {
          id: code === externalModel.code ? externalModel.providerId : anthropicModel.providerId!,
          name: code === externalModel.code ? "Local upstream" : "Anthropic upstream",
          protocol: code === externalModel.code ? "openai-compatible" : "anthropic",
          compatibility: code === externalModel.code ? "nine-router" : "standard",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          apiKey: code === externalModel.code ? "upstream-secret" : "anthropic-secret",
          headers: []
        },
        modelId: code === externalModel.code ? "model-1" : "claude-test"
      }),
      getApiClient: () => null
    });
    await gateway.initialize();
    const state = await gateway.update({ enabled: true, port: gatewayPort });

    const unauthorized = await fetch(`${state.baseUrl}/models`);
    expect(unauthorized.status).toBe(401);

    const models = await fetch(`${state.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    expect(models.status).toBe(200);
    const modelPayload = await models.json() as { data: unknown[] };
    expect(modelPayload.data).toContainEqual(expect.objectContaining({
      id: publicModelId(externalModel),
      owned_by: "byok:Local upstream"
    }));

    const chat = await fetch(`${state.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: publicModelId(externalModel), messages: [{ role: "user", content: "hello" }] })
    });
    expect(chat.status).toBe(200);
    await expect(chat.json()).resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
    expect(upstreamAuthorization).toBe("Bearer upstream-secret");
    expect(upstreamUserAgent).toBe("RouteMarket-Desktop (9Router-compatible)");
    expect(gateway.getState()).toMatchObject({ running: true, requestCount: 1 });

    const responses = await fetch(`${state.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: publicModelId(externalModel), input: "hello" })
    });
    expect(responses.status).toBe(200);
    await responses.arrayBuffer();
    expect(upstreamPaths).toContain("/v1/responses");

    const messages = await fetch(`${state.baseUrl}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: publicModelId(anthropicModel), max_tokens: 128, messages: [{ role: "user", content: "hello" }] })
    });
    expect(messages.status).toBe(200);
    await messages.arrayBuffer();
    expect(upstreamPaths).toContain("/v1/messages");
    expect(upstreamApiKey).toBe("anthropic-secret");

    const routed = await gateway.saveRoute({
      name: "Coding fallback",
      targets: [publicModelId(anthropicModel), publicModelId(externalModel)]
    });
    expect(routed.routes).toHaveLength(1);
    const routedChat = await fetch(`${state.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: `route/${routed.routes[0]!.id}`, messages: [{ role: "user", content: "hello again" }] })
    });
    expect(routedChat.status).toBe(200);
    await expect(gateway.listUsage()).resolves.toEqual([
      expect.objectContaining({ routeId: routed.routes[0]!.id, success: true }),
      expect.objectContaining({ routeId: routed.routes[0]!.id, success: false, status: 501 }),
      expect.objectContaining({ routeId: null, success: true }),
      expect.objectContaining({ routeId: null, success: true }),
      expect.objectContaining({ routeId: null, success: true })
    ]);

    await gateway.close();
    servers.splice(servers.indexOf(upstream), 1);
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("round-robins targets and opens a circuit after repeated retryable failures", async () => {
    const attempts: string[] = [];
    const upstream = createServer(async (request, response) => {
      const body = await readRequestJson(request);
      const model = typeof body.model === "string" ? body.model : "";
      attempts.push(model);
      response.setHeader("Content-Type", "application/json");
      response.statusCode = model === "model-a" ? 429 : 200;
      response.end(JSON.stringify(model === "model-a"
        ? { error: { message: "rate limited" } }
        : { choices: [{ message: { role: "assistant", content: "fallback" } }] }));
    });
    servers.push(upstream);
    const upstreamPort = await listenRandom(upstream);
    const gatewayPort = await reservePort();
    const directory = await mkdtemp(join(tmpdir(), "routemarket-local-gateway-route-"));
    directories.push(directory);
    const modelA = testExternalModel("provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "model-a");
    const modelB = testExternalModel("provider_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "model-b");
    const modelC = testExternalModel("provider_cccccccccccccccccccccccccccccccc", "model-c");
    const gateway = new LocalApiGateway({
      filePath: join(directory, "gateway.json"),
      listModels: async () => [modelA, modelB, modelC],
      resolveExternalModel: async (code) => ({
        provider: {
          id: code === modelA.code ? modelA.providerId! : code === modelB.code ? modelB.providerId! : modelC.providerId!,
          name: "Test upstream",
          protocol: "openai-compatible",
          compatibility: "standard",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          apiKey: "upstream-secret",
          headers: []
        },
        modelId: code === modelA.code ? "model-a" : code === modelB.code ? "model-b" : "model-c"
      }),
      getApiClient: () => null
    });
    await gateway.initialize();
    const state = await gateway.update({ enabled: true, port: gatewayPort });
    const routed = await gateway.saveRoute({
      name: "Priority fallback",
      strategy: "priority",
      targets: [publicModelId(modelA), publicModelId(modelB)]
    });
    const routeId = `route/${routed.routes[0]!.id}`;
    for (let index = 0; index < 4; index += 1) {
      const response = await fetch(`${state.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: routeId, messages: [{ role: "user", content: "test" }] })
      });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    expect(attempts.filter((model) => model === "model-a")).toHaveLength(3);
    expect(attempts.filter((model) => model === "model-b")).toHaveLength(4);
    expect(gateway.getState().targetHealth).toContainEqual(expect.objectContaining({
      model: publicModelId(modelA),
      consecutiveFailures: 3,
      openUntil: expect.any(String)
    }));

    attempts.length = 0;
    const roundRobin = await gateway.saveRoute({
      name: "Balanced",
      strategy: "round-robin",
      targets: [publicModelId(modelB), publicModelId(modelC)]
    });
    const balancedId = `route/${roundRobin.routes.find((route) => route.name === "Balanced")!.id}`;
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${state.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: balancedId, messages: [] })
      });
      await response.arrayBuffer();
    }
    expect(attempts).toEqual(["model-b", "model-c"]);

    await gateway.close();
    servers.splice(servers.indexOf(upstream), 1);
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("aggregates RouteMarket SSE when an OpenAI client requests a non-streaming response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-local-gateway-aggregate-"));
    directories.push(directory);
    const gatewayPort = await reservePort();
    const model = {
      code: "gpt-test",
      displayName: "GPT Test",
      source: "routemarket" as const,
      providerId: null,
      providerName: "RouteMarket",
      category: "chat" as const,
      supportsTools: true,
      supportsNativeWebSearch: false,
      supportsVision: false,
      supportsStream: true,
      supportsReasoningSummary: false,
      preferredChatProtocol: null
    };
    const apiClient = {
      request: vi.fn(async (_path: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const payload = body.protocol === "openai_responses"
          ? [
              `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Response text" })}\n\n`,
              `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", object: "response", status: "completed", output_text: "Response text" } })}\n\n`
            ].join("")
          : [
              `data: ${JSON.stringify({ id: "chatcmpl_test", choices: [{ delta: { content: "Chat " } }] })}\n\n`,
              `data: ${JSON.stringify({ id: "chatcmpl_test", choices: [{ delta: { content: "text" }, finish_reason: "stop" }] })}\n\n`,
              "data: [DONE]\n\n"
            ].join("");
        return new Response(payload, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      })
    } as unknown as RouteMarketApiClient;
    const gateway = new LocalApiGateway({
      filePath: join(directory, "gateway.json"),
      listModels: async () => [model],
      resolveExternalModel: async () => null,
      getApiClient: () => apiClient
    });
    await gateway.initialize();
    const state = await gateway.update({ enabled: true, port: gatewayPort });

    const chat = await fetch(`${state.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: publicModelId(model), messages: [{ role: "user", content: "hello" }], stream: false })
    });
    await expect(chat.json()).resolves.toMatchObject({ choices: [{ message: { content: "Chat text" } }] });

    const responses = await fetch(`${state.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: publicModelId(model), input: "hello", stream: false })
    });
    await expect(responses.json()).resolves.toMatchObject({ id: "resp_test", output_text: "Response text" });

    await gateway.close();
  });
});

function testExternalModel(providerId: string, modelId: string) {
  return {
    code: `external:${providerId}:${Buffer.from(modelId).toString("base64url")}`,
    displayName: modelId,
    source: "external" as const,
    providerId,
    providerName: "Test upstream",
    category: "chat" as const,
    supportsTools: true,
    supportsNativeWebSearch: false,
    supportsVision: false,
    supportsStream: true,
    supportsReasoningSummary: false,
    preferredChatProtocol: null
  };
}

async function readRequestJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function listenRandom(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port.");
  return address.port;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listenRandom(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
