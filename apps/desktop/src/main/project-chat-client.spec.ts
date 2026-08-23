import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopAgentProfile,
  LocalApiGatewayUsage,
  ProjectChatEvent,
  ProjectChatRequest
} from "../shared/desktop-api";
import {
  buildStoredChatHistory,
  isProjectChatAuthenticationError,
  ProjectChatClient
} from "./project-chat-client";
import type { ProjectChatToolRunner } from "./project-chat-tool-runner";
import type { ModelProviderStore } from "./model-provider-store";
import { ATTACHED_BROWSER_CHAT_TOOLS, PROJECT_CHAT_TOOLS } from "./project-chat-tools";
import { RouteMarketApiClient } from "./routemarket-api-client";

const request: ProjectChatRequest = {
  requestId: "request_1",
  sessionId: "session_1",
  sentAt: "2026-07-17T12:00:00.000Z",
  model: "model_chat",
  message: "Explain this file.",
  project: {
    localProjectId: "project_1",
    displayName: "Example Project"
  },
  contextFile: {
    relativePath: "src/index.ts",
    uri: "routemarket-work://project/project_1/src/index.ts",
    text: "export const answer = 42;",
    truncated: false
  },
  projectContext: {
    instructions: {
      relativePath: "AGENTS.md",
      text: "Always run tests.",
      truncated: false
    },
    readme: null,
    settings: {
      defaultAgent: null,
      defaultModel: null,
      cloudProjectId: null,
      ignore: []
    },
    skills: [{
      id: "review",
      name: "Code review",
      description: "Review changes safely.",
      relativePath: ".routemarket/skills/review/SKILL.md"
    }]
  },
  projectSkill: {
    id: "review",
    name: "Code review",
    relativePath: ".routemarket/skills/review/SKILL.md",
    text: "Inspect the diff and report findings by severity.",
    truncated: false
  }
};

describe("stored chat history", () => {
  it("closes interrupted user turns so a later request is not resumed implicitly", () => {
    expect(buildStoredChatHistory([{
      id: "user:old",
      sessionId: "session_1",
      localProjectId: "project_1",
      role: "user",
      content: "Generate the old workbook",
      sentAt: "2026-08-13T00:00:00.000Z"
    }])).toEqual([
      { role: "user", content: "Generate the old workbook" },
      {
        role: "assistant",
        content: "[This request was interrupted before a response was recorded. Do not resume or repeat it unless the user asks again.]"
      }
    ]);
  });

  it("marks stopped assistant turns as closed history", () => {
    expect(buildStoredChatHistory([{
      id: "assistant:old",
      sessionId: "session_1",
      localProjectId: "project_1",
      role: "assistant",
      content: "Partial result",
      sentAt: "2026-08-13T00:00:00.000Z",
      stopped: true
    }])[0]?.content).toContain("Do not resume or repeat");
  });
});

const agentProfilePayload = {
  id: "agent_builder",
  fork_source_id: "fork_platform_builder",
  name: "Project Builder",
  description: "Build and verify project changes.",
  avatar_url: "https://assets.example.test/agent.png",
  system_prompt: "Complete the requested project task and verify the result.",
  greeting: "What should we build?",
  starter_questions: ["Run the tests", "Inspect the project"],
  tags: ["development"],
  default_model_code: "model_chat",
  tools: [{ type: "mcp", serverId: "server_cloud" }],
  updated_at: "2026-07-18T00:00:00.000Z"
};

const cachedAgentProfile: DesktopAgentProfile = {
  id: "agent_cached",
  revision: 7,
  origin: "personal",
  forkSourceId: null,
  name: "Cached Agent",
  description: null,
  avatarUrl: "https://assets.example.test/cached.png",
  systemPrompt: "Continue offline.",
  greeting: null,
  starterQuestions: [],
  tags: [],
  defaultModelCode: null,
  skills: [],
  toolPermissions: [],
  executionPolicy: {
    environment: "auto",
    approvalMode: "risky_only"
  },
  tools: [],
  updatedAt: "2026-07-24T00:00:00.000Z"
};

const agentRequest: ProjectChatRequest = {
  ...request,
  requestId: "request_agent_1",
  sessionId: "session_agent_1",
  message: "Inspect the project.",
  agent: {
    agentId: "agent_builder",
    agentRevision: 1,
    executionEnvironment: "local",
    localToolGroups: ["files", "skills"],
    maxToolRounds: 4
  }
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(...events: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(events.join("")));
        controller.close();
      }
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }
  );
}

function createClient(
  events: ProjectChatEvent[] = [],
  toolRunner?: Pick<ProjectChatToolRunner, "execute"> & {
    listTools?: ProjectChatToolRunner["listTools"];
  },
  agentCache?: {
    list(): DesktopAgentProfile[];
    replace(profiles: DesktopAgentProfile[]): void;
  },
  modelProviderStore?: Pick<ModelProviderStore, "listModels" | "resolveModel"> &
    Partial<Pick<ModelProviderStore, "listMediaModels">>,
  recordUsage?: (record: LocalApiGatewayUsage) => Promise<void>
) {
  const apiClient = new RouteMarketApiClient({
    baseUrl: "https://api.example.test",
    appVersion: "0.1.0"
  });
  apiClient.setAccessToken("rmw_dt_test");
  return new ProjectChatClient({
    apiClient,
    onEvent: (event) => events.push(event),
    ...(agentCache ? { agentCache } : {}),
    ...(modelProviderStore ? { modelProviderStore } : {}),
    ...(recordUsage ? { recordUsage } : {}),
    toolRunner
  });
}

function chatFetch(response: Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith("/sessions")) {
      return jsonResponse({ session: { id: request.sessionId } });
    }
    if (url.endsWith("/turns")) {
      return jsonResponse({ session_id: request.sessionId });
    }
    return response;
  });
}

describe("ProjectChatClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends external OpenAI-compatible models directly through their configured endpoint", async () => {
    const events: ProjectChatEvent[] = [];
    const usage: LocalApiGatewayUsage[] = [];
    const providerStore = {
      listModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          name: "OpenAI",
          protocol: "openai-compatible" as const,
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-provider-secret"
        },
        modelId: "gpt-5",
        pricing: {
          currency: "USD" as const,
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 15,
          cacheReadUsdPerMillion: 0.3,
          cacheWriteUsdPerMillion: 3.75
        }
      }))
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-provider-secret");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "gpt-5", stream: true });
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"Direct response"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":90}}}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, undefined, undefined, providerStore, async (record) => { usage.push(record); }).send({
      ...request,
      model: "external:provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:Z3B0LTU"
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: "complete",
      content: "Direct response",
      responseMeta: expect.objectContaining({
        modelCode: "external:provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:Z3B0LTU",
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 90,
        elapsedMs: expect.any(Number)
      })
    }));
    expect(usage).toEqual([expect.objectContaining({
      source: "desktop_chat",
      providerName: "OpenAI",
      resolvedModel: "gpt-5",
      success: true,
      status: 200,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 90,
      estimatedCostUsdMicros: 567,
      pricingSnapshot: expect.objectContaining({ inputUsdPerMillion: 3, outputUsdPerMillion: 15 })
    })]);
  });

  it("uses the Responses API for OpenCode Zen GPT models", async () => {
    const events: ProjectChatEvent[] = [];
    const usage: LocalApiGatewayUsage[] = [];
    const providerStore = {
      listModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_opencode_zen_0000000000000",
          name: "OpenCode Zen",
          protocol: "openai-compatible" as const,
          compatibility: "opencode" as const,
          baseUrl: "https://opencode.ai/zen/v1",
          apiKey: "zen-provider-secret"
        },
        modelId: "gpt-5.6-luna"
      }))
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://opencode.ai/zen/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer zen-provider-secret");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "gpt-5.6-luna", stream: true, store: false });
      expect(body).toHaveProperty("instructions");
      expect(body).toHaveProperty("input");
      return sseResponse(
        'data: {"type":"response.output_text.delta","delta":"Zen response"}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, undefined, undefined, providerStore, async (record) => { usage.push(record); }).send({
      ...request,
      model: "external:provider_opencode_zen_0000000000000:Z3B0LTUuNi1sdW5h"
    });

    expect(events).toContainEqual(expect.objectContaining({ type: "complete", content: "Zen response" }));
    expect(usage).toEqual([expect.objectContaining({ kind: "responses", providerName: "OpenCode Zen", success: true })]);
  });

  it("does not send local or search tools to a model marked as not supporting tools", async () => {
    const providerStore = {
      listModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          name: "Compatible API",
          protocol: "openai-compatible" as const,
          baseUrl: "https://models.example.test/v1",
          apiKey: "provider-secret"
        },
        modelId: "plain-chat"
      }))
    };
    const toolRunner = {
      listTools: vi.fn(async () => PROJECT_CHAT_TOOLS),
      execute: vi.fn()
    };
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
      return sseResponse("data: [DONE]\n\n");
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient([], toolRunner, undefined, providerStore).send({
      ...request,
      model: "external:provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cGxhaW4tY2hhdA",
      modelSupportsTools: false,
      webSearchMode: "agentic"
    });

    expect(toolRunner.listTools).not.toHaveBeenCalled();
  });

  it("converts Anthropic Messages responses into the existing chat event stream", async () => {
    const events: ProjectChatEvent[] = [];
    const providerStore = {
      listModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          name: "Anthropic",
          protocol: "anthropic" as const,
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "anthropic-secret"
        },
        modelId: "claude-sonnet-4-5"
      }))
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/messages");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("anthropic-secret");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "claude-sonnet-4-5", max_tokens: 8192, stream: true });
      return sseResponse(
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Anthropic "}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"response"}}\n\n',
        'data: {"type":"message_stop"}\n\n'
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, undefined, undefined, providerStore).send({
      ...request,
      model: "external:provider_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:Y2xhdWRlLXNvbm5ldC00LTU"
    });

    expect(events).toContainEqual(expect.objectContaining({ type: "complete", content: "Anthropic response" }));
  });

  it("keeps the local Tool loop when using the Anthropic protocol", async () => {
    const events: ProjectChatEvent[] = [];
    const providerStore = {
      listModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_cccccccccccccccccccccccccccccccc",
          name: "Anthropic",
          protocol: "anthropic" as const,
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "anthropic-secret"
        },
        modelId: "claude-sonnet-4-5"
      }))
    };
    const toolRunner = {
      execute: vi.fn(async () => ({ content: JSON.stringify({ files: ["README.md"] }), summary: "1 file", isError: false }))
    };
    let round = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      round += 1;
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: unknown }> };
      if (round === 2) {
        expect(body.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({ role: "assistant", content: expect.arrayContaining([expect.objectContaining({ type: "tool_use", name: "project_list_files" })]) }),
          expect.objectContaining({ role: "user", content: expect.arrayContaining([expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1" })]) })
        ]));
      }
      return jsonResponse(round === 1
        ? { content: [{ type: "tool_use", id: "toolu_1", name: "project_list_files", input: { path: "." } }] }
        : { content: [{ type: "text", text: "README.md" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, toolRunner, undefined, providerStore).send({
      ...request,
      model: "external:provider_cccccccccccccccccccccccccccccccc:Y2xhdWRlLXNvbm5ldC00LTU"
    });

    expect(toolRunner.execute).toHaveBeenCalledWith(
      request.project!.localProjectId,
      expect.objectContaining({ name: "project_list_files", arguments: '{"path":"."}' }),
      expect.any(AbortSignal),
      expect.any(Object)
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "complete", content: "README.md" }));
  });

  it("passes Managed Browser screenshots to vision models as native Anthropic image blocks", async () => {
    const providerStore = {
      listModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_vision_anthropic_000000000000",
          name: "Anthropic",
          protocol: "anthropic" as const,
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "anthropic-secret"
        },
        modelId: "claude-sonnet-4-5"
      }))
    };
    const screenshot = "data:image/jpeg;base64,c2NyZWVuc2hvdA==";
    const toolRunner = {
      execute: vi.fn(async () => ({
        content: JSON.stringify({ page_id: "page_1", image_attached: true }),
        summary: "Browser screenshot",
        isError: false,
        images: [screenshot]
      }))
    };
    let round = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      round += 1;
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ name?: string }>;
        messages: Array<{ role: string; content: unknown }>;
      };
      if (round === 1) {
        expect(body.tools?.map((tool) => tool.name)).toContain("browser_screenshot");
        return jsonResponse({
          content: [{ type: "tool_use", id: "toolu_screenshot", name: "browser_screenshot", input: {} }]
        });
      }
      expect(body.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_screenshot" }),
            expect.objectContaining({
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: "c2NyZWVuc2hvdA=="
              }
            })
          ])
        })
      ]));
      return jsonResponse({ content: [{ type: "text", text: "The page is visible." }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient([], toolRunner, undefined, providerStore).send({
      ...request,
      requestId: "request_vision_anthropic",
      model: "external:provider_vision_anthropic_000000000000:Y2xhdWRlLXNvbm5ldC00LTU",
      modelSupportsVision: true
    });

    expect(toolRunner.execute).toHaveBeenCalledWith(
      request.project!.localProjectId,
      expect.objectContaining({ name: "browser_screenshot" }),
      expect.any(AbortSignal),
      expect.any(Object)
    );
  });

  it("does not expose the screenshot Tool to a model without vision support", async () => {
    const providerStore = {
      listModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_text_only_00000000000000000",
          name: "Text-only provider",
          protocol: "openai-compatible" as const,
          baseUrl: "https://text-only.example/v1",
          apiKey: "provider-secret"
        },
        modelId: "text-only-model"
      }))
    };
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      const names = body.tools?.map((tool) => tool.function?.name) ?? [];
      expect(names).not.toContain("browser_screenshot");
      expect(names).not.toContain("browser_attached_screenshot");
      expect(names).toContain("browser_inspect");
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"Text response"}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient([], {
      listTools: vi.fn(async () => [...PROJECT_CHAT_TOOLS, ...ATTACHED_BROWSER_CHAT_TOOLS]),
      execute: vi.fn()
    }, undefined, providerStore).send({
      ...request,
      requestId: "request_text_only",
      model: "external:provider_text_only_00000000000000000:dGV4dC1vbmx5LW1vZGVs",
      modelSupportsVision: false
    });
  });

  it("returns an empty model catalog instead of rejecting during a transient outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse({ message: "Internal server error" }, 500))
    );

    await expect(createClient().listModels()).resolves.toEqual([]);
  });

  it("normalizes supported chat models and ignores invalid entries", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          {
            code: "model_chat",
            display_name: "Chat Model",
            icon_url: "/assets/models/chat.svg",
            icon_storage_provider: "public",
            icon_storage_key: "https://assets.example.test/models/chat.svg",
            category: "chat",
            supports_tools: true,
            supports_native_web_search: true,
            supports_reasoning_controls: true,
            preferred_chat_protocol: "openai_responses",
            supports_vision: false,
            supports_stream: true,
            picker_primary_price: 0.8,
            picker_price_components: [{
              display_name: "Input",
              billing_metric: "input_tokens",
              unit_label: "1M tokens",
              unit_size: 1_000_000,
              sale_price: 0.8
            }]
          },
          {
            code: "model_reasoning",
            display_name: "Reasoning Model",
            icon_url: "lobehub:DeepSeek",
            category: "reasoning"
          },
          {
            code: "model_image",
            display_name: "Image Model",
            category: "image"
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient().listModels()).resolves.toEqual([
      {
        code: "model_chat",
        displayName: "Chat Model",
        iconUrl: "https://api.example.test/assets/models/chat.svg",
        iconStorageProvider: "public",
        iconStorageKey: "https://assets.example.test/models/chat.svg",
        source: "routemarket",
        providerId: null,
        providerName: "RouteMarket",
        category: "chat",
        supportsTools: true,
        supportsNativeWebSearch: true,
        supportsVision: false,
        supportsStream: true,
        supportsReasoningSummary: true,
        preferredChatProtocol: "openai_responses",
        platformPricing: {
          primaryCredit: 0.8,
          components: [{
            displayName: "Input",
            billingMetric: "input_tokens",
            unitLabel: "1M tokens",
            unitSize: 1_000_000,
            salePrice: 0.8
          }]
        }
      },
      {
        code: "model_reasoning",
        displayName: "Reasoning Model",
        iconUrl: "lobehub:DeepSeek",
        iconStorageProvider: null,
        iconStorageKey: null,
        source: "routemarket",
        providerId: null,
        providerName: "RouteMarket",
        category: "reasoning",
        supportsTools: false,
        supportsNativeWebSearch: false,
        supportsVision: false,
        supportsStream: false,
        supportsReasoningSummary: false,
        preferredChatProtocol: null
      }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/app/v1/workspace/picker-data?categories=chat%2Creasoning&detail=catalog",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer rmw_dt_test"
        })
      })
    );
  });

  it("loads media models from an isolated category without mixing chat models", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      items: [
        {
          code: "gpt-image-2",
          display_name: "GPT Image 2",
          icon_url: "/assets/models/gpt-image.svg",
          category: "image",
          picker_primary_price: 1.6,
          default_group_ids: ["group_gpt_image_2"]
        },
        {
          code: "model_chat",
          display_name: "Chat Model",
          category: "chat"
        }
      ],
      channel_groups: [{
        id: "group_gpt_image_2",
        logical_model: { code: "gpt-image-2" },
        items: [{
          image_capabilities: {
            parameters: [
              { key: "size", options: [{ value: "1024x1024", label: "1024x1024" }], default_value: "1024x1024" },
              { key: "quality", options: [
                { value: "low", label: "low" },
                { value: "medium", label: "medium" },
                { value: "high", label: "high" }
              ], default_value: "medium" }
            ],
            supported_sizes: ["1024x1024"],
            supported_qualities: ["low", "medium", "high"],
            supported_counts: [1, 2],
            supported_outputs: [{
              value: "size=1024x1024&ratio=1%3A1",
              label: "1024x1024",
              size: "1024x1024",
              resolution: null,
              ratio: "1:1",
              unsupported: false
            }],
            default_size: "1024x1024",
            default_quality: "medium",
            default_count: 1
          },
          price_components: [
            { billing_metric: "request_count", sale_price: 0, unit_size: 1 },
            { billing_metric: "output_items", sale_price: 1.6, unit_size: 1, attributes: { quality: "low" } },
            { billing_metric: "output_items", sale_price: 6.3, unit_size: 1, attributes: { quality: "medium" } },
            { billing_metric: "output_items", sale_price: 25, unit_size: 1, attributes: { quality: "high" } }
          ]
        }]
      }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient().listMediaModels("image")).resolves.toEqual([{
      code: "gpt-image-2",
      displayName: "GPT Image 2",
      iconUrl: "https://api.example.test/assets/models/gpt-image.svg",
      iconStorageProvider: null,
      iconStorageKey: null,
      category: "image",
      source: "routemarket",
      providerId: null,
      providerName: "RouteMarket",
      audioModes: [],
      price: 1.6,
      imageCapabilities: {
        sizes: [{
          value: "1024x1024",
          label: "1024x1024",
          resolution: null,
          ratio: "1:1"
        }],
        qualities: [
          { value: "low", label: "low" },
          { value: "medium", label: "medium" },
          { value: "high", label: "high" }
        ],
        counts: [1, 2],
        defaultSize: "1024x1024",
        defaultQuality: "medium",
        defaultCount: 1,
        requestCredits: 0,
        prices: [
          { size: null, quality: "low", resolution: null, ratio: null, credits: 1.6 },
          { size: null, quality: "medium", resolution: null, ratio: null, credits: 6.3 },
          { size: null, quality: "high", resolution: null, ratio: null, credits: 25 }
        ]
      }
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/app/v1/workspace/picker-data?categories=image&detail=surface",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer rmw_dt_test" }) })
    );
  });

  it("loads and normalizes the same community inspiration feed used by Web", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      items: [{
        id: "post_image_1",
        kind: "image",
        title: "Forest light",
        prompt: "A mossy forest with cinematic morning light",
        model_code: "gpt-image-2",
        model_name: "GPT Image 2",
        tags: ["forest"],
        official_tag_codes: ["landscape", "cinematic"],
        thumbnail_url: "/media/thumb.jpg",
        media_url: "https://cdn.example.test/image.jpg",
        mime_type: "image/jpeg",
        like_count: 88,
        save_count: 12,
        view_count: 1042,
        author: { id: "author_1", name: "RouteMarket", avatar_url: "/avatars/route.png" }
      }],
      has_more: true,
      next_cursor: "cursor_2"
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient().listMediaInspiration({
      kind: "image",
      sort: "trending",
      query: "forest",
      officialTag: "cinematic"
    })).resolves.toEqual({
      items: [{
        id: "post_image_1",
        kind: "image",
        title: "Forest light",
        prompt: "A mossy forest with cinematic morning light",
        modelCode: "gpt-image-2",
        modelName: "GPT Image 2",
        tags: ["forest"],
        officialTagCodes: ["landscape", "cinematic"],
        thumbnailUrl: "https://api.example.test/media/thumb.jpg",
        mediaUrl: "https://cdn.example.test/image.jpg",
        mimeType: "image/jpeg",
        likeCount: 88,
        saveCount: 12,
        viewCount: 1042,
        author: {
          id: "author_1",
          name: "RouteMarket",
          avatarUrl: "https://api.example.test/avatars/route.png"
        }
      }],
      hasMore: true,
      nextCursor: "cursor_2"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/app/v1/community/posts?kind=image&sort=trending&limit=24&q=forest&official_tag=cinematic",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer rmw_dt_test" }) })
    );
  });

  it("loads the database-backed inspiration tags used by Web", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      items: [
        { code: "portrait", label: "人像", kinds: ["image"] },
        { code: "cinematic", label: "电影感", kinds: ["image", "video"] }
      ],
      all: []
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient().listMediaInspirationTags("image")).resolves.toEqual([
      { code: "portrait", label: "人像" },
      { code: "cinematic", label: "电影感" }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/app/v1/discovery/tags?kind=image",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer rmw_dt_test" }) })
    );
  });

  it("submits image generation through the desktop media endpoint", async () => {
    const usage: LocalApiGatewayUsage[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.example.test/api/app/v1/work/media/images");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "gpt-image-2",
        session_source: "desktop",
        prompt: "A quiet harbor at sunrise",
        n: 2,
        async_mode: true,
        size: "1024x1024",
        quality: "high"
      });
      return jsonResponse({
        data: [{ id: "image_1", url: "https://cdn.example.test/image.png" }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient(
      [],
      undefined,
      undefined,
      undefined,
      async (record) => { usage.push(record); }
    ).generateMedia({
      kind: "image",
      model: "gpt-image-2",
      prompt: "A quiet harbor at sunrise",
      size: "1024x1024",
      quality: "high",
      count: 2
    })).resolves.toEqual({
      taskId: null,
      outputs: [{
        id: "image_1",
        kind: "image",
        url: "https://cdn.example.test/image.png",
        downloadUrl: null,
        thumbnailUrl: null,
        mimeType: null,
        revisedPrompt: null
      }]
    });
    expect(usage).toEqual([
      expect.objectContaining({
        source: "desktop_media",
        kind: "image",
        requestedModel: "gpt-image-2",
        resolvedModel: "gpt-image-2",
        success: true,
        status: 200
      })
    ]);
  });

  it("generates images directly with a local OpenAI-compatible media model", async () => {
    const usage: LocalApiGatewayUsage[] = [];
    const providerStore = {
      listModels: vi.fn(async () => []),
      listMediaModels: vi.fn(async () => []),
      resolveModel: vi.fn(async () => ({
        provider: {
          id: "provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          name: "Studio GPU",
          protocol: "openai-compatible" as const,
          baseUrl: "http://127.0.0.1:8188/v1",
          apiKey: ""
        },
        modelId: "local-sdxl"
      }))
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:8188/v1/images/generations");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "local-sdxl",
        prompt: "A local watercolor",
        n: 1,
        response_format: "url",
        size: "1024x1024",
        quality: "standard"
      });
      return jsonResponse({ data: [{ b64_json: "aW1hZ2U=" }, { url: "/files/generated.png" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient(
      [], undefined, undefined, providerStore, async (record) => { usage.push(record); }
    ).generateMedia({
      kind: "image",
      model: "external:provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bG9jYWwtc2R4bA",
      prompt: "A local watercolor",
      size: "1024x1024",
      quality: "standard"
    })).resolves.toMatchObject({
      outputs: [
        { kind: "image", url: "data:image/png;base64,aW1hZ2U=" },
        { kind: "image", url: "http://127.0.0.1:8188/files/generated.png" }
      ]
    });
    expect(usage).toEqual([expect.objectContaining({
      kind: "image",
      providerName: "Studio GPU",
      resolvedModel: "local-sdxl",
      success: true
    })]);
  });

  it("runs intelligent search through the authenticated RouteMarket search service", async () => {
    const events: ProjectChatEvent[] = [];
    const modelBodies: Record<string, unknown>[] = [];
    let modelRound = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/tools/web-search")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          query: "RouteMarket release",
          max_results: 5,
          provider: "auto",
          credential_id: null,
          allow_official_fallback: true
        });
        return jsonResponse({
          results: [{
            title: "RouteMarket",
            url: "https://routemarket.ai",
            snippet: "Official"
          }]
        });
      }
      modelBodies.push(JSON.parse(String(init?.body)));
      modelRound += 1;
      return modelRound === 1
        ? sseResponse(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_search_1","type":"function","function":{"name":"web_search","arguments":"{\\"query\\":\\"RouteMarket release\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
            "data: [DONE]\n\n"
          )
        : sseResponse(
            'data: {"choices":[{"delta":{"content":"Found the current release."}}]}\n\n',
            "data: [DONE]\n\n"
          );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events).send({
      ...request,
      requestId: "request_search_1",
      webSearchMode: "agentic"
    });

    expect(modelBodies[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "web_search" })
        })
      ])
    );
    expect(events).toContainEqual(expect.objectContaining({
      requestId: "request_search_1",
      type: "tool_completed",
      toolCallId: "call_search_1",
      toolName: "web_search",
      title: "联网搜索",
      summary: "已检索 “RouteMarket release” · 1 条结果"
    }));
    expect(events.at(-1)).toMatchObject({
      requestId: "request_search_1",
      type: "complete",
      content: "Found the current release."
    });
  });

  it("passes native search to a Responses-capable model without local credentials", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return sseResponse(
        'data: {"type":"response.output_text.delta","delta":"Native result"}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient().send({
      ...request,
      requestId: "request_native_search_1",
      webSearchMode: "native"
    });

    expect(requestBody).toEqual(expect.objectContaining({
      protocol: "openai_responses",
      tools: expect.arrayContaining([{ type: "web_search" }])
    }));
  });

  it("sends uploaded images as vision blocks and includes attachment metadata", async () => {
    let requestBody: Record<string, any> | null = null;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"I can see the image."}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient().send({
      ...request,
      requestId: "request_attachment_1",
      modelSupportsVision: true,
      attachments: [{
        id: "attachment_1",
        name: "diagram.png",
        mimeType: "image/png",
        size: 2048,
        kind: "image",
        textExcerpt: null,
        assetId: "asset_1",
        downloadUrl: "https://assets.example.test/diagram.png",
        previewUrl: "https://assets.example.test/diagram-preview.png"
      }]
    });

    const content = requestBody!.messages[0].content;
    expect(content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("diagram.png (image/png, 2048 bytes)")
      }),
      {
        type: "image_url",
        image_url: { url: "https://assets.example.test/diagram.png" }
      }
    ]);
  });

  it("normalizes Agent profiles and authorizes the Core Agent API request", async () => {
    const cache = {
      list: vi.fn(() => [] as DesktopAgentProfile[]),
      replace: vi.fn()
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          agentProfilePayload,
          { id: "invalid_agent", name: "Missing prompt" }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient([], undefined, cache).listAgents()).resolves.toEqual([{
      id: "agent_builder",
      revision: 1,
      origin: "template",
      forkSourceId: "fork_platform_builder",
      name: "Project Builder",
      description: "Build and verify project changes.",
      avatarUrl: "https://assets.example.test/agent.png",
      systemPrompt: "Complete the requested project task and verify the result.",
      greeting: "What should we build?",
      starterQuestions: ["Run the tests", "Inspect the project"],
      tags: ["development"],
      defaultModelCode: "model_chat",
      skills: [],
      toolPermissions: [{ type: "mcp", serverId: "server_cloud" }],
      executionPolicy: {
        environment: "auto",
        approvalMode: "risky_only"
      },
      tools: [{ type: "mcp", serverId: "server_cloud" }],
      updatedAt: "2026-07-18T00:00:00.000Z"
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/app/v1/work/agents",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer rmw_dt_test"
        })
      })
    );
    expect(cache.replace).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "agent_builder",
        revision: 1,
        avatarUrl: "https://assets.example.test/agent.png"
      })
    ]);
  });

  it("keeps the Web default platform Agent ahead of personal Agents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse({
        items: [
          {
            ...agentProfilePayload,
            id: "agent_personal",
            fork_source_id: null,
            name: "Personal Agent"
          },
          agentProfilePayload
        ]
      }))
    );

    await expect(createClient().listAgents()).resolves.toEqual([
      expect.objectContaining({ id: "agent_builder", origin: "template" }),
      expect.objectContaining({ id: "agent_personal", origin: "personal" })
    ]);
  });

  it("falls back to the shared Core platform Agent catalog for accounts without seeded Agents", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/app/v1/agents/platform")) {
        return jsonResponse({
          items: [{
            ...agentProfilePayload,
            id: "platform_builder",
            user_id: null,
            fork_source_id: null,
            is_public: true
          }]
        });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient().listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: "platform_builder",
        origin: "template",
        forkSourceId: null,
        name: "Project Builder"
      })
    ]);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/app/v1/work/agents",
      "https://api.example.test/api/app/v1/agents/platform"
    ]);
  });

  it("can run a platform Agent fallback without creating an account-side copy", async () => {
    const events: ProjectChatEvent[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/app/v1/agents/platform")) {
        return jsonResponse({
          items: [{
            ...agentProfilePayload,
            user_id: null,
            fork_source_id: null,
            is_public: true
          }]
        });
      }
      if (url.endsWith("/api/app/v1/work/agents")) {
        return jsonResponse({ message: "Invalid session" }, 401);
      }
      if (url.endsWith("/api/app/v1/work/agents/agent_builder")) {
        return jsonResponse({ message: "Invalid session" }, 401);
      }
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: agentRequest.sessionId } });
      }
      if (url.endsWith("/turns")) {
        return jsonResponse({ session_id: agentRequest.sessionId });
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"Platform Agent ready."}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(events);

    await client.listAgents();
    await client.send(agentRequest);

    expect(events.at(-1)).toMatchObject({
      requestId: "request_agent_1",
      type: "complete",
      content: "Platform Agent ready."
    });
  });

  it("uses the cached Agent catalog during network and service outages", async () => {
    const cache = {
      list: vi.fn(() => [cachedAgentProfile]),
      replace: vi.fn()
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(createClient([], undefined, cache).listAgents()).resolves
      .toEqual([cachedAgentProfile]);

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ message: "Unavailable" }, 503)
      )
    );
    await expect(createClient([], undefined, cache).listAgents()).resolves
      .toEqual([cachedAgentProfile]);
    expect(cache.replace).not.toHaveBeenCalled();
  });

  it("returns an empty Agent catalog instead of rejecting when a transient outage has no cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse({ message: "Internal server error" }, 500))
    );

    await expect(createClient([]).listAgents()).resolves.toEqual([]);
  });

  it("uses platform Agents when the account catalog rejects a Desktop Device Token", async () => {
    const cache = {
      list: vi.fn(() => [cachedAgentProfile]),
      replace: vi.fn()
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/api/app/v1/agents/platform")) {
        return jsonResponse({
          items: [{
            ...agentProfilePayload,
            id: "platform_builder",
            user_id: null,
            fork_source_id: null,
            is_public: true
          }]
        });
      }
      return jsonResponse({ message: "Invalid session" }, 401);
    });
    vi.stubGlobal(
      "fetch",
      fetchMock
    );

    await expect(createClient([], undefined, cache).listAgents()).resolves.toEqual([
      expect.objectContaining({ id: "platform_builder", origin: "template" })
    ]);
    expect(cache.list).not.toHaveBeenCalled();
    expect(cache.replace).toHaveBeenCalledWith([
      expect.objectContaining({ id: "platform_builder", origin: "template" })
    ]);
  });

  it("uses platform Agents when Core does not yet expose the work Agent catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/api/app/v1/agents/platform")) {
        return jsonResponse({
          items: [{
            ...agentProfilePayload,
            id: "platform_builder",
            user_id: null,
            fork_source_id: null,
            is_public: true
          }]
        });
      }
      return jsonResponse({ message: "Not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient([]).listAgents()).resolves.toEqual([
      expect.objectContaining({ id: "platform_builder", origin: "template" })
    ]);
  });

  it("preserves the account authentication error if the platform catalog is also unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/api/app/v1/agents/platform")
        ? jsonResponse({ message: "Unavailable" }, 503)
        : jsonResponse({ message: "Invalid session" }, 400)
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await createClient([]).listAgents().catch((failure) => failure);
    expect(isProjectChatAuthenticationError(error)).toBe(true);
    expect((error as Error).message).toBe("Invalid session");
  });

  it("streams OpenAI chat completion deltas and completes with accumulated text", async () => {
    const events: ProjectChatEvent[] = [];
    const fetchMock = chatFetch(
      sseResponse(
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n"
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events).send(request);

    expect(events).toEqual([
      { requestId: "request_1", type: "delta", content: "Hello" },
      { requestId: "request_1", type: "delta", content: "Hello world" },
      expect.objectContaining({ requestId: "request_1", type: "complete", content: "Hello world" })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/app\/v1\/work\/chat\/local$/);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      session_id: "session_1",
      request_id: "request_1",
      model: "model_chat",
      stream: true
    });
    expect(body.system_prompt).toContain("Always run tests.");
    expect(body.system_prompt).toContain("Code review (review)");
    expect(body.system_prompt).toContain("<project-skill id=\"review\"");
    expect(body.system_prompt).toContain("Inspect the diff and report findings by severity.");
    expect(body.messages[0].content).toContain("src/index.ts");
    expect(body.messages[0].content).toContain("export const answer = 42;");
  });

  it("keeps folder tools unavailable for a project without a linked folder", async () => {
    const fetchMock = chatFetch(sseResponse("data: [DONE]\n\n"));
    const listTools = vi.fn(async () => PROJECT_CHAT_TOOLS);
    vi.stubGlobal("fetch", fetchMock);

    await createClient([], {
      listTools,
      execute: vi.fn()
    }).send({
      ...request,
      project: { ...request.project!, hasFolder: false },
      contextFile: undefined,
      projectContext: undefined,
      projectSkill: undefined
    });

    expect(listTools).not.toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tools).toEqual([]);
    expect(body.system_prompt).toContain("not linked to a local folder");
  });

  it("streams Responses API output text deltas", async () => {
    const events: ProjectChatEvent[] = [];
    vi.stubGlobal(
      "fetch",
      chatFetch(
        sseResponse(
          'data: {"type":"response.output_text.delta","delta":"First"}\n\n',
          'data: {"type":"response.output_text.delta","delta":" second"}\n\n',
          'data: {"type":"response.completed","response":{}}\n\n'
        )
      )
    );

    await createClient(events).send(request);

    expect(events.at(-1)).toMatchObject({
      requestId: "request_1",
      type: "complete",
      content: "First second"
    });
  });

  it("opts into and emits Responses API reasoning summaries", async () => {
    const events: ProjectChatEvent[] = [];
    let requestBody: Record<string, any> | null = null;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return sseResponse(
        'data: {"type":"response.reasoning_summary_text.delta","delta":"Checking files"}\n\n',
        'data: {"type":"response.reasoning_summary_text.delta","delta":" and tests."}\n\n',
        'data: {"type":"response.output_text.delta","delta":"All good."}\n\n',
        "data: [DONE]\n\n"
      );
    }));

    await createClient(events).send({
      ...request,
      preferredChatProtocol: "openai_responses",
      reasoningSummary: "auto",
      reasoningEffort: "high"
    });

    expect(requestBody).toEqual(expect.objectContaining({
      protocol: "openai_responses",
      adapter_payload: { body: { reasoning: { summary: "auto", effort: "high" } } }
    }));
    expect(events).toContainEqual({
      requestId: "request_1",
      type: "reasoning",
      content: "Checking files and tests."
    });
    expect(events.at(-1)).toMatchObject({
      requestId: "request_1",
      type: "complete",
      content: "All good."
    });
  });

  it("fetches the authoritative Agent profile and filters local Tools by permission group", async () => {
    const skillTool = {
      type: "function" as const,
      function: {
        name: "skill_local_review_123456789abc",
        description: "Load the review Skill.",
        parameters: { type: "object", properties: {}, additionalProperties: false }
      }
    };
    const mcpTool = {
      type: "function" as const,
      function: {
        name: "mcp_local_excel_read_123456789abc",
        description: "Read Excel.",
        parameters: { type: "object", properties: {}, additionalProperties: false }
      }
    };
    const toolRunner = {
      listTools: vi.fn(async () => [...PROJECT_CHAT_TOOLS, skillTool, mcpTool]),
      execute: vi.fn()
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/agents/agent_builder/versions/1")) {
        return jsonResponse({
          revision: 1,
          source: "create",
          created_at: "2026-07-18T00:00:00.000Z",
          snapshot: {
            name: "Project Builder",
            description: "Build and verify project changes.",
            avatarUrl: "https://assets.example.test/agent.png",
            systemPrompt: "Complete the requested project task and verify the result.",
            greeting: "What should we build?",
            starterQuestions: ["Run the tests", "Inspect the project"],
            tags: ["development"],
            defaultModelCode: "model_chat",
            skills: [
              {
                skillId: "review",
                name: "Code review",
                source: "local",
                enabled: true
              },
              {
                skillId: "research",
                name: "Cloud research",
                source: "cloud",
                enabled: true
              }
            ],
            tools: [{ type: "mcp", serverId: "server_cloud" }]
          }
        });
      }
      if (url.endsWith("/agents/agent_builder")) {
        return jsonResponse({ ...agentProfilePayload, revision: 2 });
      }
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: agentRequest.sessionId } });
      }
      if (url.endsWith("/turns")) {
        return jsonResponse({ session_id: agentRequest.sessionId });
      }
      expect(init?.headers).toMatchObject({ "x-request-id": "request_agent_1" });
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"Project inspected."}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const events: ProjectChatEvent[] = [];

    await createClient(events, toolRunner).send(agentRequest);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/app/v1/work/agents/agent_builder"
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer rmw_dt_test"
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/agents/agent_builder/versions/1"
    );
    const modelBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(modelBody.system_prompt).toContain(
      'RouteMarket Agent profile "Project Builder"'
    );
    expect(modelBody.system_prompt).toContain(
      "Complete the requested project task and verify the result."
    );
    expect(modelBody.system_prompt).toContain(
      "Agent profile explicitly enables these project-local Skills"
    );
    expect(modelBody.system_prompt).toContain("Code review (review)");
    expect(modelBody.system_prompt).toContain(
      "Cloud research (research): 云端 Skill 尚未接入 Desktop 本地运行时"
    );
    const toolNames = modelBody.tools.map(
      (tool: { function: { name: string } }) => tool.function.name
    );
    expect(toolNames).toContain("project_read_file");
    expect(toolNames).toContain("skill_local_review_123456789abc");
    expect(toolNames).not.toContain("project_start_process");
    expect(toolNames).not.toContain("browser_navigate");
    expect(toolNames).not.toContain("mcp_local_excel_read_123456789abc");
    expect(toolRunner.execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      requestId: "request_agent_1",
      type: "complete",
      content: "Project inspected."
    });
  });

  it("marks local Tool calls from an Agent session with the Agent source", async () => {
    const toolRunner = {
      listTools: vi.fn(async () => PROJECT_CHAT_TOOLS),
      execute: vi.fn(async () => ({
        content: JSON.stringify({ path: "src/index.ts", text: "export {};" }),
        summary: "src/index.ts",
        isError: false
      }))
    };
    let modelRound = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/agents/agent_builder")) {
        return jsonResponse({
          ...agentProfilePayload,
          execution_policy: {
            environment: "local",
            approvalMode: "never_ask"
          }
        });
      }
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: agentRequest.sessionId } });
      }
      if (url.endsWith("/turns")) {
        return jsonResponse({ session_id: agentRequest.sessionId });
      }
      modelRound += 1;
      if (modelRound === 1) {
        return sseResponse(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_agent_read","type":"function","function":{"name":"project_read_file","arguments":"{\\"path\\":\\"src/index.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n"
        );
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"Inspected."}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient([], toolRunner).send(agentRequest);

    expect(toolRunner.execute).toHaveBeenCalledWith(
      "project_1",
      {
        id: "call_agent_read",
        name: "project_read_file",
        arguments: '{"path":"src/index.ts"}'
      },
      expect.any(AbortSignal),
      { source: "agent", approvalMode: "never_ask" }
    );
  });

  it("rejects an Agent Tool call outside the desktop permission policy", async () => {
    const events: ProjectChatEvent[] = [];
    const toolRunner = {
      listTools: vi.fn(async () => PROJECT_CHAT_TOOLS),
      execute: vi.fn()
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/agents/agent_builder")) {
        return jsonResponse(agentProfilePayload);
      }
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: agentRequest.sessionId } });
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_browser_1","type":"function","function":{"name":"browser_navigate","arguments":"{\\"url\\":\\"https://example.com\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, toolRunner).send(agentRequest);

    expect(toolRunner.execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      requestId: "request_agent_1",
      type: "error",
      message:
        "The Agent requested a local Tool outside its permission policy: browser_navigate"
    });
  });

  it("stops the Agent Tool loop at the configured maximum round count", async () => {
    const events: ProjectChatEvent[] = [];
    const toolRunner = {
      listTools: vi.fn(async () => PROJECT_CHAT_TOOLS),
      execute: vi.fn(async () => ({
        content: JSON.stringify({ url: "about:blank" }),
        summary: "Browser state",
        isError: false
      }))
    };
    let modelRound = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/agents/agent_builder")) {
        return jsonResponse(agentProfilePayload);
      }
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: agentRequest.sessionId } });
      }
      modelRound += 1;
      return sseResponse(
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_browser_${modelRound}","type":"function","function":{"name":"browser_get_state","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n`,
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, toolRunner).send({
      ...agentRequest,
      agent: {
        agentId: "agent_builder",
        agentRevision: 1,
        executionEnvironment: "local",
        localToolGroups: ["browser"],
        maxToolRounds: 2
      }
    });

    expect(modelRound).toBe(2);
    expect(toolRunner.execute).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({
      requestId: "request_agent_1",
      type: "error",
      message: "The local Tool loop reached its maximum number of rounds."
    });
  });

  it("executes streamed local Tool calls and continues the model with Tool results", async () => {
    const events: ProjectChatEvent[] = [];
    const dynamicMcpTool = {
      type: "function" as const,
      function: {
        name: "mcp_local_excel_read_sheet_123456789abc",
        description: "Read a local Excel worksheet.",
        parameters: {
          type: "object",
          properties: {
            sheet: { type: "string" }
          },
          required: ["sheet"],
          additionalProperties: false
        }
      }
    };
    const toolRunner = {
      listTools: vi.fn(async () => [...PROJECT_CHAT_TOOLS, dynamicMcpTool]),
      execute: vi.fn(async () => ({
        content: JSON.stringify({
          path: "src/index.ts",
          text: "export const answer = 42;",
          sha256: "a".repeat(64)
        }),
        summary: "src/index.ts · 25 bytes",
        isError: false
      }))
    };
    let chatRound = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: request.sessionId } });
      }
      if (url.endsWith("/turns")) {
        return jsonResponse({ session_id: request.sessionId });
      }
      chatRound += 1;
      if (chatRound === 1) {
        return sseResponse(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read_1","type":"function","function":{"name":"project_read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"src/index.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n"
        );
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"The answer is 42."}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, toolRunner).send(request);

    expect(toolRunner.listTools).toHaveBeenCalledOnce();
    expect(toolRunner.listTools).toHaveBeenCalledWith("project_1");
    expect(toolRunner.execute).toHaveBeenCalledWith(
      "project_1",
      {
        id: "call_read_1",
        name: "project_read_file",
        arguments: '{"path":"src/index.ts"}'
      },
      expect.any(AbortSignal),
      { source: "chat", approvalMode: "risky_only" }
    );
    expect(events).toContainEqual(expect.objectContaining({
      requestId: "request_1",
      type: "tool_started",
      toolCallId: "call_read_1",
      toolName: "project_read_file",
      title: "读取项目文件",
      startedAt: expect.any(Number),
      inputPreview: expect.stringContaining("src/index.ts")
    }));
    expect(events).toContainEqual(expect.objectContaining({
      requestId: "request_1",
      type: "tool_completed",
      toolCallId: "call_read_1",
      toolName: "project_read_file",
      title: "读取项目文件",
      summary: "src/index.ts · 25 bytes",
      endedAt: expect.any(Number),
      outputPreview: expect.stringContaining("answer = 42")
    }));
    expect(events.at(-1)).toMatchObject({
      requestId: "request_1",
      type: "complete",
      content: "The answer is 42."
    });

    const firstRound = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstRound.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "project_read_file" })
        }),
        expect.objectContaining({
          function: expect.objectContaining({ name: "project_start_process" })
        }),
        expect.objectContaining({
          function: expect.objectContaining({
            name: "mcp_local_excel_read_sheet_123456789abc"
          })
        })
      ])
    );
    const secondRound = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRound.tools).toEqual(firstRound.tools);
    expect(secondRound.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_read_1",
          type: "function",
          function: {
            name: "project_read_file",
            arguments: '{"path":"src/index.ts"}'
          }
        }]
      },
      {
        role: "tool",
        tool_call_id: "call_read_1",
        content: expect.stringContaining('"sha256"')
      }
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-request-id": "request_1_tool_round_1"
    });
  });

  it("offers project Skills to the model and continues with loaded instructions", async () => {
    const events: ProjectChatEvent[] = [];
    const skillTool = {
      type: "function" as const,
      function: {
        name: "skill_local_review_123456789abc",
        description: "Load the project review Skill.",
        parameters: {
          type: "object",
          properties: {
            task: { type: "string" }
          },
          required: ["task"],
          additionalProperties: false
        }
      }
    };
    const toolRunner = {
      listTools: vi.fn(async () => [...PROJECT_CHAT_TOOLS, skillTool]),
      execute: vi.fn(async () => ({
        content: JSON.stringify({
          skill_id: "review",
          task: "Review the current changes.",
          instructions: "Inspect the diff and report findings by severity."
        }),
        summary: "Code review · 49 characters",
        isError: false
      }))
    };
    let chatRound = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: request.sessionId } });
      }
      if (url.endsWith("/turns")) {
        return jsonResponse({ session_id: request.sessionId });
      }
      chatRound += 1;
      if (chatRound === 1) {
        return sseResponse(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_skill_1","type":"function","function":{"name":"skill_local_review_123456789abc","arguments":"{\\"task\\":\\"Review the current changes.\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n"
        );
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"I found one issue."}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, toolRunner).send(request);

    expect(toolRunner.execute).toHaveBeenCalledWith(
      "project_1",
      {
        id: "call_skill_1",
        name: "skill_local_review_123456789abc",
        arguments: '{"task":"Review the current changes."}'
      },
      expect.any(AbortSignal),
      { source: "chat", approvalMode: "risky_only" }
    );
    expect(events).toContainEqual(expect.objectContaining({
      requestId: "request_1",
      type: "tool_started",
      toolCallId: "call_skill_1",
      toolName: "skill_local_review_123456789abc",
      title: "调用项目 Skill",
      startedAt: expect.any(Number),
      inputPreview: expect.stringContaining("Review the current changes")
    }));
    expect(events).toContainEqual(expect.objectContaining({
      requestId: "request_1",
      type: "tool_completed",
      toolCallId: "call_skill_1",
      toolName: "skill_local_review_123456789abc",
      title: "调用项目 Skill",
      summary: "Code review · 49 characters",
      endedAt: expect.any(Number),
      outputPreview: expect.stringContaining("report findings by severity")
    }));

    const firstRound = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstRound.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        function: expect.objectContaining({
          name: "skill_local_review_123456789abc"
        })
      })
    ]));
    expect(firstRound.system_prompt).toContain(
      "Project-local Skills available through the local Skill Runtime."
    );
    const secondRound = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRound.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_skill_1",
      content: expect.stringContaining("report findings by severity")
    });
    expect(events.at(-1)).toMatchObject({
      requestId: "request_1",
      type: "complete",
      content: "I found one issue."
    });
  });

  it("emits a stopped event when an active request is cancelled", async () => {
    const events: ProjectChatEvent[] = [];
    const fetchMock = vi.fn<typeof fetch>(
      (input, init) => {
        if (String(input).endsWith("/sessions")) {
          return Promise.resolve(jsonResponse({ session: { id: request.sessionId } }));
        }
        return (
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(events);

    const pending = client.send(request);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    client.stop(request.requestId);
    await pending;

    expect(events).toEqual([
      { requestId: "request_1", type: "stopped", content: "" }
    ]);
  });

  it("emits an error event for an unsuccessful HTTP response", async () => {
    const events: ProjectChatEvent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith("/sessions")
          ? jsonResponse({ session: { id: request.sessionId } })
          : jsonResponse({ message: "Model is unavailable." }, 503)
      )
    );

    await createClient(events).send(request);

    expect(events).toEqual([
      {
        requestId: "request_1",
        type: "error",
        message: "Model is unavailable."
      }
    ]);
  });
});
