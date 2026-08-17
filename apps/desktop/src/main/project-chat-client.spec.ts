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
import { PROJECT_CHAT_TOOLS } from "./project-chat-tools";
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
  modelProviderStore?: Pick<ModelProviderStore, "listModels" | "resolveModel">,
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
        modelId: "gpt-5"
      }))
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-provider-secret");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "gpt-5", stream: true });
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"Direct response"}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient(events, undefined, undefined, providerStore, async (record) => { usage.push(record); }).send({
      ...request,
      model: "external:provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:Z3B0LTU"
    });

    expect(events).toContainEqual(expect.objectContaining({ type: "complete", content: "Direct response" }));
    expect(usage).toEqual([expect.objectContaining({
      source: "desktop_chat",
      providerName: "OpenAI",
      resolvedModel: "gpt-5",
      success: true,
      status: 200
    })]);
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
            category: "chat",
            supports_tools: true,
            supports_native_web_search: true,
            supports_reasoning_controls: true,
            preferred_chat_protocol: "openai_responses",
            supports_vision: false,
            supports_stream: true
          },
          {
            code: "model_reasoning",
            display_name: "Reasoning Model",
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
        source: "routemarket",
        providerId: null,
        providerName: "RouteMarket",
        category: "chat",
        supportsTools: true,
        supportsNativeWebSearch: true,
        supportsVision: false,
        supportsStream: true,
        supportsReasoningSummary: true,
        preferredChatProtocol: "openai_responses"
      },
      {
        code: "model_reasoning",
        displayName: "Reasoning Model",
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
      "https://api.example.test/api/app/v1/work/chat/models?purpose=chat",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer rmw_dt_test"
        })
      })
    );
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
    expect(events).toContainEqual({
      requestId: "request_search_1",
      type: "tool_completed",
      toolCallId: "call_search_1",
      toolName: "web_search",
      title: "联网搜索",
      summary: "已检索 “RouteMarket release” · 1 条结果"
    });
    expect(events.at(-1)).toEqual({
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
      "https://api.example.test/api/app/v1/agents",
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

  it("does not hide an authentication failure behind cached Agents", async () => {
    const cache = {
      list: vi.fn(() => [cachedAgentProfile]),
      replace: vi.fn()
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ message: "Authentication required." }, 401)
      )
    );

    const error = await createClient([], undefined, cache).listAgents().catch((failure) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Authentication required.");
    expect(isProjectChatAuthenticationError(error)).toBe(true);
    expect(cache.list).not.toHaveBeenCalled();
  });

  it("recognizes the Core invalid-session response even when its status is not 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse({ message: "Invalid session" }, 400))
    );

    const error = await createClient([]).listAgents().catch((failure) => failure);
    expect(isProjectChatAuthenticationError(error)).toBe(true);
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
      { requestId: "request_1", type: "complete", content: "Hello world" }
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

    expect(events.at(-1)).toEqual({
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
      reasoningSummary: "auto"
    });

    expect(requestBody).toEqual(expect.objectContaining({
      protocol: "openai_responses",
      adapter_payload: { body: { reasoning: { summary: "auto" } } }
    }));
    expect(events).toContainEqual({
      requestId: "request_1",
      type: "reasoning",
      content: "Checking files and tests."
    });
    expect(events.at(-1)).toEqual({
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
      "https://api.example.test/api/app/v1/agents/agent_builder"
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
    expect(events.at(-1)).toEqual({
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
    expect(events).toContainEqual({
      requestId: "request_1",
      type: "tool_started",
      toolCallId: "call_read_1",
      toolName: "project_read_file",
      title: "读取项目文件"
    });
    expect(events).toContainEqual({
      requestId: "request_1",
      type: "tool_completed",
      toolCallId: "call_read_1",
      toolName: "project_read_file",
      title: "读取项目文件",
      summary: "src/index.ts · 25 bytes"
    });
    expect(events.at(-1)).toEqual({
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
    expect(events).toContainEqual({
      requestId: "request_1",
      type: "tool_started",
      toolCallId: "call_skill_1",
      toolName: "skill_local_review_123456789abc",
      title: "调用项目 Skill"
    });
    expect(events).toContainEqual({
      requestId: "request_1",
      type: "tool_completed",
      toolCallId: "call_skill_1",
      toolName: "skill_local_review_123456789abc",
      title: "调用项目 Skill",
      summary: "Code review · 49 characters"
    });

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
    expect(events.at(-1)).toEqual({
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
