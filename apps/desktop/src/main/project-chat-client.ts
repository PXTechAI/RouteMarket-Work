import { randomUUID } from "node:crypto";
import { trMain } from "./i18n";
import type {
  AgentLocalToolGroup,
  ChatModel,
  DesktopChatAttachment,
  DesktopAgentProfile,
  LocalProjectChatMessage,
  LocalApiGatewayUsage,
  MediaInspirationPage,
  MediaInspirationPost,
  MediaInspirationQuery,
  MediaInspirationTag,
  MediaGenerationOutput,
  MediaGenerationRequest,
  MediaGenerationResult,
  MediaImageCapabilities,
  MediaModel,
  MediaModelCategory,
  ModelTokenPricing,
  ProjectChatEvent,
  ProjectChatRequest
} from "../shared/desktop-api";
import { resolveDesktopAgentSkillAvailability } from "../shared/agent-skill-availability";
import { readProjectChatStream } from "./project-chat-stream";
import { extractProjectOutputArtifacts } from "./project-chat-artifacts";
import { redactCloudData, redactCloudText } from "./cloud-redaction";
import type { RouteMarketApiClient } from "./routemarket-api-client";
import { modelProviderRequestHeaders, modelProviderUsesResponses, type ModelProviderStore, type ResolvedModelProvider } from "./model-provider-store";
import {
  emptyModelTokenUsage,
  extractModelTokenUsage,
  mergeModelTokenUsage,
  sumModelTokenUsage,
  type ModelTokenUsage
} from "./model-token-usage";
import { estimateModelUsageCost, type ModelUsageAccounting } from "./model-usage-cost";
import type { ProjectChatToolRunner } from "./project-chat-tool-runner";
import {
  PROJECT_CHAT_TOOLS,
  projectChatToolTitle,
  type ProjectChatToolCall,
  type ProjectChatToolDefinition,
  type ProjectChatToolExecution
} from "./project-chat-tools";

type ProjectChatClientOptions = {
  apiClient: RouteMarketApiClient;
  onEvent(event: ProjectChatEvent): void;
  agentCache?: {
    list(): DesktopAgentProfile[];
    replace(profiles: DesktopAgentProfile[]): void;
  };
  toolRunner?: Pick<ProjectChatToolRunner, "execute"> & {
    listTools?: ProjectChatToolRunner["listTools"];
  };
  modelProviderStore?: Pick<ModelProviderStore, "listModels" | "resolveModel"> &
    Partial<Pick<ModelProviderStore, "listMediaModels">>;
  recordUsage?(record: LocalApiGatewayUsage): Promise<void>;
};

type ModelsResponse = {
  items?: unknown[];
  channel_groups?: unknown[];
};

type AgentsResponse = {
  items?: unknown[];
};

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CALLS = 24;
const WEB_SEARCH_TOOL: ProjectChatToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information through the user's RouteMarket search preference.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query."
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
};

export class ProjectChatResponseError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ProjectChatResponseError";
  }
}

export function isProjectChatAuthenticationError(error: unknown): boolean {
  return error instanceof ProjectChatResponseError && (
    error.status === 401 || error.message.trim().toLowerCase() === "invalid session"
  );
}

export class ProjectChatClient {
  private catalogAgents = new Map<string, DesktopAgentProfile>();

  private readonly activeRequests = new Map<string, AbortController>();

  constructor(private readonly options: ProjectChatClientOptions) {}

  async listModels(): Promise<ChatModel[]> {
    const externalModels = await this.options.modelProviderStore?.listModels().catch(() => []) ?? [];
    try {
      const response = await this.requestApp(
        "/api/app/v1/workspace/picker-data?categories=chat%2Creasoning&detail=catalog"
      );
      const payload = (await response.json().catch(() => null)) as ModelsResponse | null;
      if (!response.ok) {
        throw new ProjectChatResponseError(
          readResponseError(payload, response.status),
          response.status
        );
      }
      return [
        ...(Array.isArray(payload?.items) ? payload.items : [])
          .map((model) => normalizeModel(model, this.options.apiClient.origin))
          .filter((model): model is ChatModel => model !== null),
        ...externalModels
      ];
    } catch (error) {
      if (externalModels.length || isTransientCatalogFailure(error)) return externalModels;
      throw error;
    }
  }

  async listMediaModels(kind: MediaModelCategory): Promise<MediaModel[]> {
    const localModels = await this.options.modelProviderStore?.listMediaModels?.(kind).catch(() => []) ?? [];
    try {
      const response = await this.requestApp(
        `/api/app/v1/workspace/picker-data?categories=${encodeURIComponent(kind)}&detail=surface`
      );
      const payload = (await response.json().catch(() => null)) as ModelsResponse | null;
      if (!response.ok) {
        throw new ProjectChatResponseError(
          readResponseError(payload, response.status),
          response.status
        );
      }
      return [
        ...(Array.isArray(payload?.items) ? payload.items : [])
          .map((model) => normalizeMediaModel(
            model,
            kind,
            this.options.apiClient.origin,
            Array.isArray(payload?.channel_groups) ? payload.channel_groups : []
          ))
          .filter((model): model is MediaModel => model !== null),
        ...localModels
      ];
    } catch (error) {
      if (localModels.length || isTransientCatalogFailure(error)) return localModels;
      throw error;
    }
  }

  async listMediaInspiration(input: MediaInspirationQuery): Promise<MediaInspirationPage> {
    const params = new URLSearchParams({
      kind: input.kind,
      sort: input.sort ?? "trending",
      limit: "24"
    });
    if (input.query?.trim()) params.set("q", input.query.trim());
    if (input.officialTag?.trim()) params.set("official_tag", input.officialTag.trim());
    if (input.cursor) params.set("cursor", input.cursor);
    const response = await this.requestApp(`/api/app/v1/community/posts?${params.toString()}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ProjectChatResponseError(readResponseError(payload, response.status), response.status);
    }
    const record = asRecord(payload);
    const items = Array.isArray(record?.items) ? record.items : [];
    return {
      items: items
        .map((post) => normalizeMediaInspirationPost(post, input.kind, this.options.apiClient.origin))
        .filter((post): post is MediaInspirationPost => post !== null),
      hasMore: record?.has_more === true,
      nextCursor: typeof record?.next_cursor === "string" && record.next_cursor ? record.next_cursor : null
    };
  }

  async listMediaInspirationTags(kind: MediaModelCategory): Promise<MediaInspirationTag[]> {
    const response = await this.requestApp(
      `/api/app/v1/discovery/tags?kind=${encodeURIComponent(kind)}`
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ProjectChatResponseError(readResponseError(payload, response.status), response.status);
    }
    const record = asRecord(payload);
    return (Array.isArray(record?.items) ? record.items : []).flatMap((value) => {
      const tag = asRecord(value);
      return tag && typeof tag.code === "string" && typeof tag.label === "string"
        ? [{ code: tag.code, label: tag.label }]
        : [];
    });
  }

  async generateMedia(input: MediaGenerationRequest): Promise<MediaGenerationResult> {
    const startedAt = Date.now();
    const external = await this.options.modelProviderStore?.resolveModel(input.model) ?? null;
    const providerId = external?.provider.id ?? null;
    const providerName = external?.provider.name ?? "RouteMarket";
    const resolvedModel = external?.modelId ?? input.model;
    try {
      const result = external
        ? await this.generateExternalMediaRequest(input, external)
        : await this.generateMediaRequest(input);
      await this.recordModelUsage({
        source: "desktop_media",
        kind: input.kind,
        providerId,
        providerName,
        requestedModel: input.model,
        resolvedModel,
        routeId: null,
        status: 200,
        durationMs: Date.now() - startedAt,
        success: true,
        ...result.usage
      });
      return result;
    } catch (error) {
      await this.recordModelUsage({
        source: "desktop_media",
        kind: input.kind,
        providerId,
        providerName,
        requestedModel: input.model,
        resolvedModel,
        routeId: null,
        status: error instanceof ProjectChatResponseError ? error.status : null,
        durationMs: Date.now() - startedAt,
        success: false
      });
      throw error;
    }
  }

  private async generateExternalMediaRequest(
    input: MediaGenerationRequest,
    external: ResolvedModelProvider
  ): Promise<MediaGenerationResult> {
    if (external.provider.protocol !== "openai-compatible") {
      throw new Error("Local media generation requires an OpenAI-compatible provider.");
    }
    const endpoint = input.kind === "image"
      ? "images/generations"
      : input.kind === "video" ? "videos/generations" : "audio/speech";
    const response = await fetch(`${external.provider.baseUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        ...modelProviderRequestHeaders({ ...external.provider, apiKey: external.provider.apiKey }),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildExternalMediaRequestBody(input, external.modelId))
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (input.kind === "audio" && response.ok && !contentType.includes("json")) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error("The local audio model returned an empty response.");
      const mimeType = contentType.split(";", 1)[0] || defaultMediaMimeType("audio");
      const url = `data:${mimeType};base64,${bytes.toString("base64")}`;
      return {
        taskId: null,
        outputs: [{
          id: `audio-${randomUUID()}`,
          kind: "audio",
          url,
          downloadUrl: null,
          thumbnailUrl: null,
          mimeType,
          revisedPrompt: null
        }]
      };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ProjectChatResponseError(readResponseError(payload, response.status), response.status);
    }
    const outputs = normalizeMediaOutputs(payload, input.kind).map((output) =>
      resolveExternalMediaOutputUrls(output, external.provider.baseUrl)
    );
    if (!outputs.length) {
      throw new Error("The local model completed without returning media output.");
    }
    return { taskId: readTaskId(payload), outputs };
  }

  private async generateMediaRequest(input: MediaGenerationRequest): Promise<MediaGenerationResult> {
    const requestId = randomUUID();
    const body = buildMediaRequestBody(input);
    const endpoint = input.kind === "image" ? "images" : input.kind === "video" ? "videos" : "audio";
    const response = await this.requestApp(`/api/app/v1/work/media/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ProjectChatResponseError(
        readResponseError(payload, response.status),
        response.status
      );
    }

    const taskId = readTaskId(payload);
    if (!taskId) {
      const outputs = normalizeMediaOutputs(payload, input.kind);
      if (!outputs.length) throw new Error("RouteMarket did not return generated media.");
      return { taskId: null, outputs };
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await delay(1_500);
      const taskResponse = await this.requestApp(
        `/api/app/v1/work/media/tasks/${encodeURIComponent(taskId)}`
      );
      const task = await taskResponse.json().catch(() => null);
      if (!taskResponse.ok) {
        throw new ProjectChatResponseError(
          readResponseError(task, taskResponse.status),
          taskResponse.status
        );
      }
      const status = readStringField(task, "status")?.toLowerCase();
      if (status === "failed" || status === "cancelled" || status === "canceled") {
        throw new Error(readResponseError(task, taskResponse.status));
      }
      if (status === "succeeded" || status === "completed" || status === "success") {
        const outputs = normalizeMediaOutputs(task, input.kind);
        if (!outputs.length) throw new Error("RouteMarket completed the task without media output.");
        return { taskId, outputs };
      }
    }
    throw new Error("Media generation timed out. The task may still be running in RouteMarket.");
  }

  async listAgents(): Promise<DesktopAgentProfile[]> {
    let response: Response;
    try {
      response = await this.requestApp("/api/app/v1/work/agents");
    } catch (error) {
      const cached = this.options.agentCache?.list() ?? [];
      if (cached.length || isTransientCatalogFailure(error)) return cached;
      throw error;
    }
    const payload = (await response.json().catch(() => null)) as AgentsResponse | null;
    if (!response.ok) {
      const responseError = new ProjectChatResponseError(
        readResponseError(payload, response.status),
        response.status
      );
      // Keep the catalog useful against older Core deployments that do not yet
      // expose the Device Token account-Agent endpoint.
      if (response.status === 404 || isProjectChatAuthenticationError(responseError)) {
        try {
          return this.rememberAgents(await this.listPlatformAgents());
        } catch {
          const cached = this.options.agentCache?.list() ?? [];
          if (cached.length) return cached;
          throw responseError;
        }
      }
      if (isTransientCatalogStatus(response.status)) {
        const cached = this.options.agentCache?.list() ?? [];
        return cached;
      }
      throw responseError;
    }
    let agents = (Array.isArray(payload?.items) ? payload.items : [])
      .map((agent) => normalizeAgent(agent, this.options.apiClient.origin))
      .filter((agent): agent is DesktopAgentProfile => agent !== null);
    if (agents.length === 0) {
      agents = await this.listPlatformAgents();
    }
    return this.rememberAgents(agents);
  }

  private async listPlatformAgents(): Promise<DesktopAgentProfile[]> {
    const response = await this.requestApp("/api/app/v1/agents/platform");
    const payload = (await response.json().catch(() => null)) as AgentsResponse | null;
    if (!response.ok) {
      throw new ProjectChatResponseError(
        readResponseError(payload, response.status),
        response.status
      );
    }
    return (Array.isArray(payload?.items) ? payload.items : [])
      .map((agent) => normalizeAgent(agent, this.options.apiClient.origin, "template"))
      .filter((agent): agent is DesktopAgentProfile => agent !== null);
  }

  private rememberAgents(agents: DesktopAgentProfile[]): DesktopAgentProfile[] {
    agents.sort((left, right) => Number(left.origin !== "template") - Number(right.origin !== "template"));
    this.catalogAgents = new Map(agents.map((agent) => [agent.id, agent]));
    this.options.agentCache?.replace(agents);
    return agents;
  }

  async send(input: ProjectChatRequest): Promise<void> {
    if (this.activeRequests.has(input.requestId)) {
      throw new Error("This chat request is already running.");
    }

    const controller = new AbortController();
    this.activeRequests.set(input.requestId, controller);
    let content = "";
    let reasoning = "";
    let responseUsage = emptyModelTokenUsage();
    const requestStartedAt = Date.now();

    try {
      const agent = input.agent
        ? await this.getAgent(
            input.agent.agentId,
            input.agent.agentRevision,
            controller.signal
          )
        : null;
      const executionEnvironment = resolveExecutionEnvironment(input);
      const availableTools = input.modelSupportsTools === false || executionEnvironment === "cloud" || !input.project || input.project.hasFolder === false
        ? []
        : this.options.toolRunner?.listTools
          ? await this.options.toolRunner.listTools(input.project.localProjectId)
          : PROJECT_CHAT_TOOLS;
      const modelCompatibleTools = input.modelSupportsVision === true
        ? availableTools
        : availableTools.filter((tool) => ![
            "browser_screenshot",
            "browser_attached_screenshot"
          ].includes(tool.function.name));
      const localTools = filterTools(
        modelCompatibleTools,
        input.agent?.localToolGroups,
        agent?.toolPermissions
      );
      const tools = input.modelSupportsTools !== false && input.webSearchMode === "agentic"
        ? [...localTools, WEB_SEARCH_TOOL]
        : localTools;
      const extraMessages: Record<string, unknown>[] = [];
      let toolCallCount = 0;
      let completed = false;
      const maxToolRounds = input.agent
        ? clampToolRounds(input.agent.maxToolRounds)
        : MAX_TOOL_ROUNDS;

      for (let round = 0; round < maxToolRounds; round += 1) {
        const contentBeforeRound = content;
        const reasoningBeforeRound = reasoning;
        const result = await this.requestModelRound(
          input,
          agent,
          extraMessages,
          tools,
          round,
          controller.signal,
          (roundText) => {
            content = appendRoundText(contentBeforeRound, roundText);
            this.options.onEvent({
              requestId: input.requestId,
              type: "delta",
              content
            });
          },
          (roundReasoning) => {
            reasoning = appendRoundText(reasoningBeforeRound, roundReasoning);
            this.options.onEvent({
              requestId: input.requestId,
              type: "reasoning",
              content: reasoning
            });
          }
        );
        content = appendRoundText(contentBeforeRound, result.text);
        reasoning = appendRoundText(reasoningBeforeRound, result.reasoning);
        responseUsage = sumModelTokenUsage(responseUsage, result.usage);

        if (!result.toolCalls.length) {
          completed = true;
          break;
        }
        if (
          !this.options.toolRunner &&
          result.toolCalls.some((call) => call.name !== "web_search")
        ) {
          throw new Error("The local chat Tool runtime is unavailable.");
        }

        toolCallCount += result.toolCalls.length;
        if (toolCallCount > MAX_TOOL_CALLS) {
          throw new Error("The model requested too many local Tool calls.");
        }

        const calls = normalizeToolCalls(result.toolCalls, input.requestId, round);
        const allowedToolNames = new Set(tools.map((tool) => tool.function.name));
        for (const call of calls) {
          if (!allowedToolNames.has(call.name)) {
            throw new Error(`The Agent requested a local Tool outside its permission policy: ${call.name}`);
          }
        }
        extraMessages.push({
          role: "assistant",
          content: result.text || null,
          tool_calls: calls.map(toTranscriptToolCall)
        });

        const roundImages: string[] = [];
        for (const call of calls) {
          const title = projectChatToolTitle(call.name);
          const startedAt = Date.now();
          this.options.onEvent({
            requestId: input.requestId,
            type: "tool_started",
            toolCallId: call.id,
            toolName: call.name,
            title,
            startedAt,
            inputPreview: formatToolPreview(call.arguments)
          });
          const execution = call.name === "web_search"
            ? await this.executeWebSearch(call, controller.signal)
            : await this.options.toolRunner!.execute(
                input.project!.localProjectId,
                call,
                controller.signal,
                {
                  source: input.agent ? "agent" : "chat",
                  approvalMode:
                    agent?.executionPolicy.approvalMode ?? "risky_only"
                }
              );
          if (execution.isError) {
            this.options.onEvent({
              requestId: input.requestId,
              type: "tool_error",
              toolCallId: call.id,
              toolName: call.name,
              title,
              message: execution.summary,
              endedAt: Date.now(),
              outputPreview: formatToolPreview(execution.content)
            });
          } else {
            this.options.onEvent({
              requestId: input.requestId,
              type: "tool_completed",
              toolCallId: call.id,
              toolName: call.name,
              title,
              summary: execution.summary,
              endedAt: Date.now(),
              outputPreview: formatToolPreview(execution.content)
            });
            const outputArtifacts = dedupeArtifacts([
              ...(execution.artifacts ?? []),
              ...extractProjectOutputArtifacts(
                input.project!.localProjectId,
                execution.content,
                call.name
              )
            ]);
            if (outputArtifacts.length) {
              this.options.onEvent({
                requestId: input.requestId,
                type: "artifacts",
                artifacts: outputArtifacts
              });
            }
          }
          extraMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: execution.content
          });
          if (input.modelSupportsVision === true) {
            roundImages.push(...readToolImages(execution));
          }
        }
        if (roundImages.length) {
          extraMessages.push({
            role: "user",
            content: [
              {
                type: "text",
                text: "Managed Browser screenshot(s) from the preceding Tool result. Use them as visual page state for the next browser action."
              },
              ...roundImages.map((url) => ({
                type: "image_url",
                image_url: { url }
              }))
            ]
          });
        }
      }

      if (!completed) {
        throw new Error("The local Tool loop reached its maximum number of rounds.");
      }

      if (controller.signal.aborted) {
        this.options.onEvent({
          requestId: input.requestId,
          type: "stopped",
          content
        });
      } else {
        this.options.onEvent({
          requestId: input.requestId,
          type: "complete",
          content,
          responseMeta: {
            modelCode: input.model,
            inputTokens: responseUsage.inputTokens ?? null,
            outputTokens: responseUsage.outputTokens ?? null,
            totalTokens: responseUsage.totalTokens ?? null,
            cachedInputTokens: responseUsage.cachedInputTokens ?? null,
            cacheCreationInputTokens: responseUsage.cacheCreationInputTokens ?? null,
            elapsedMs: Math.max(0, Date.now() - requestStartedAt)
          }
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        this.options.onEvent({
          requestId: input.requestId,
          type: "stopped",
          content
        });
      } else {
        this.options.onEvent({
          requestId: input.requestId,
          type: "error",
          message: error instanceof Error ? error.message : "Unknown chat error",
          ...(content ? { content } : {})
        });
      }
    } finally {
      this.activeRequests.delete(input.requestId);
    }
  }

  stop(requestId: string): void {
    this.activeRequests.get(requestId)?.abort();
  }

  stopAll(): void {
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
  }

  private async requestModelRound(
    input: ProjectChatRequest,
    agent: DesktopAgentProfile | null,
    extraMessages: Record<string, unknown>[],
    tools: typeof PROJECT_CHAT_TOOLS,
    round: number,
    signal: AbortSignal,
    onText: (text: string) => void,
    onReasoning: (reasoning: string) => void
  ) {
    const startedAt = Date.now();
    let providerId: string | null = null;
    let providerName = "RouteMarket";
    let resolvedModel = input.model;
    let pricing: ModelTokenPricing | null = null;
    let accounting: ModelUsageAccounting = "openai";
    let kind: LocalApiGatewayUsage["kind"] = input.webSearchMode === "native" || input.preferredChatProtocol === "openai_responses"
      ? "responses"
      : "chat";
    try {
      const external = await this.options.modelProviderStore?.resolveModel(input.model) ?? null;
      let result;
      if (external) {
        providerId = external.provider.id;
        providerName = external.provider.name;
        resolvedModel = external.modelId;
        pricing = external.pricing ?? null;
        accounting = external.provider.protocol === "anthropic" ? "anthropic" : "openai";
        const useResponses = modelProviderUsesResponses(external.provider, external.modelId);
        kind = external.provider.protocol === "anthropic"
          ? "anthropic_messages"
          : useResponses
            ? "responses"
            : "chat";
        result = external.provider.protocol === "anthropic"
          ? await this.requestAnthropicRound(external, input, agent, extraMessages, tools, signal, onText)
          : useResponses
            ? await this.requestOpenAiResponsesRound(
                external,
                input,
                agent,
                extraMessages,
                tools,
                signal,
                onText,
                onReasoning
              )
            : await this.requestOpenAiCompatibleRound(
              external,
              input,
              agent,
              extraMessages,
              tools,
              signal,
              onText,
              onReasoning
            );
      } else {
        const requestTools = input.webSearchMode === "native"
          ? [...tools, { type: "web_search" as const }]
          : tools;
        const response = await this.request("/local", {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": roundRequestId(input.requestId, round)
          },
          body: JSON.stringify({
            session_id: input.sessionId,
            request_id: input.requestId,
            model: input.model,
            system_prompt: buildSystemPrompt(
              input,
              agent,
              tools.some((tool) => tool.function.name.startsWith("skill_local_"))
            ),
            messages: [
              ...(input.history ?? []),
              { role: "user", content: buildMessageContent(input) },
              ...extraMessages
            ],
            tools: requestTools,
            tool_choice: "auto",
            parallel_tool_calls: false,
            ...(kind === "responses" ? { protocol: "openai_responses" } : {}),
            ...(input.reasoningSummary || input.reasoningEffort
              ? {
                  adapter_payload: {
                    body: {
                      reasoning: {
                        ...(input.reasoningSummary ? { summary: input.reasoningSummary } : {}),
                        ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {})
                      }
                    }
                  }
                }
              : {}),
            stream: true
          })
        });
        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => null);
          throw new ProjectChatResponseError(readResponseError(payload, response.status), response.status);
        }
        result = await readProjectChatStream(response.body, signal, onText, onReasoning);
      }
      await this.recordModelUsage({
        source: "desktop_chat",
        kind,
        providerId,
        providerName,
        requestedModel: input.model,
        resolvedModel,
        routeId: null,
        status: 200,
        durationMs: Date.now() - startedAt,
        success: true,
        ...result.usage,
        ...estimateModelUsageCost(result.usage, pricing, accounting)
      });
      return result;
    } catch (error) {
      await this.recordModelUsage({
        source: "desktop_chat",
        kind,
        providerId,
        providerName,
        requestedModel: input.model,
        resolvedModel,
        routeId: null,
        status: error instanceof ProjectChatResponseError ? error.status : null,
        durationMs: Date.now() - startedAt,
        success: false
      });
      throw error;
    }
  }

  private async requestOpenAiCompatibleRound(
    resolved: ResolvedModelProvider,
    input: ProjectChatRequest,
    agent: DesktopAgentProfile | null,
    extraMessages: Record<string, unknown>[],
    tools: typeof PROJECT_CHAT_TOOLS,
    signal: AbortSignal,
    onText: (text: string) => void,
    onReasoning: (reasoning: string) => void
  ) {
    const response = await fetch(`${resolved.provider.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        ...modelProviderRequestHeaders(resolved.provider),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: resolved.modelId,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(
              input,
              agent,
              tools.some((tool) => tool.function.name.startsWith("skill_local_"))
            )
          },
          ...(input.history ?? []),
          { role: "user", content: buildMessageContent(input) },
          ...extraMessages
        ],
        ...(tools.length ? {
          tools,
          tool_choice: "auto",
          parallel_tool_calls: false
        } : {}),
        stream: true,
        stream_options: { include_usage: true }
      })
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new ProjectChatResponseError(readResponseError(payload, response.status), response.status);
    }
    return readProjectChatStream(response.body, signal, onText, onReasoning);
  }

  private async requestOpenAiResponsesRound(
    resolved: ResolvedModelProvider,
    input: ProjectChatRequest,
    agent: DesktopAgentProfile | null,
    extraMessages: Record<string, unknown>[],
    tools: typeof PROJECT_CHAT_TOOLS,
    signal: AbortSignal,
    onText: (text: string) => void,
    onReasoning: (reasoning: string) => void
  ) {
    const response = await fetch(`${resolved.provider.baseUrl}/responses`, {
      method: "POST",
      signal,
      headers: {
        ...modelProviderRequestHeaders(resolved.provider),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: resolved.modelId,
        instructions: buildSystemPrompt(
          input,
          agent,
          tools.some((tool) => tool.function.name.startsWith("skill_local_"))
        ),
        input: toOpenAiResponsesInput(input, extraMessages),
        ...(tools.length ? {
          tools: tools.map((tool) => ({
            type: "function",
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
            strict: false
          })),
          tool_choice: "auto",
          parallel_tool_calls: false
        } : {}),
        ...(input.reasoningSummary || input.reasoningEffort
          ? {
              reasoning: {
                ...(input.reasoningSummary ? { summary: input.reasoningSummary } : {}),
                ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {})
              }
            }
          : {}),
        stream: true,
        store: false
      })
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new ProjectChatResponseError(readResponseError(payload, response.status), response.status);
    }
    return readProjectChatStream(response.body, signal, onText, onReasoning);
  }

  private async requestAnthropicRound(
    resolved: ResolvedModelProvider,
    input: ProjectChatRequest,
    agent: DesktopAgentProfile | null,
    extraMessages: Record<string, unknown>[],
    tools: typeof PROJECT_CHAT_TOOLS,
    signal: AbortSignal,
    onText: (text: string) => void
  ) {
    const response = await fetch(`${resolved.provider.baseUrl}/messages`, {
      method: "POST",
      signal,
      headers: {
        ...modelProviderRequestHeaders(resolved.provider),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: resolved.modelId,
        max_tokens: 8192,
        stream: true,
        system: buildSystemPrompt(
          input,
          agent,
          tools.some((tool) => tool.function.name.startsWith("skill_local_"))
        ),
        messages: toAnthropicMessages(input, extraMessages),
        ...(tools.length ? {
          tools: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters
          }))
        } : {})
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      throw new ProjectChatResponseError(readResponseError(payload, response.status), response.status);
    }
    if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
      return readAnthropicStream(response.body, signal, onText);
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const content = Array.isArray(payload?.content) ? payload.content : [];
    const text = content.flatMap((value) => {
      const block = asRecord(value);
      return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
    }).join("");
    const toolCalls = content.flatMap((value): ProjectChatToolCall[] => {
      const block = asRecord(value);
      if (block?.type !== "tool_use" || typeof block.name !== "string") return [];
      return [{
        id: typeof block.id === "string" ? block.id : "",
        name: block.name,
        arguments: JSON.stringify(asRecord(block.input) ?? {})
      }];
    });
    if (text) onText(text);
    return {
      text,
      reasoning: "",
      toolCalls,
      usage: extractModelTokenUsage(payload) ?? emptyModelTokenUsage()
    };
  }

  private async executeWebSearch(
    call: ProjectChatToolCall,
    signal: AbortSignal
  ): Promise<ProjectChatToolExecution> {
    let query = "";
    try {
      const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      query = typeof args.query === "string" ? args.query.trim() : "";
    } catch {
      // Invalid arguments are returned to the model as a Tool error.
    }
    if (!query) {
      return {
        content: JSON.stringify({ error: "Search query is required." }),
        summary: trMain("ui.7237ce669c74"),
        isError: true
      };
    }
    const response = await this.requestApp("/api/app/v1/tools/web-search", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        max_results: 5,
        provider: "auto",
        credential_id: null,
        allow_official_fallback: true
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        content: JSON.stringify({
          error: readResponseError(payload, response.status)
        }),
        summary: trMain("ui.b24eba102ea4", [response.status]),
        isError: true
      };
    }
    const results =
      payload && typeof payload === "object" &&
      Array.isArray((payload as { results?: unknown[] }).results)
        ? (payload as { results: unknown[] }).results
        : [];
    return {
      content: JSON.stringify({ query, results }),
      summary: trMain("ui.118496b37c5b", [query, results.length]),
      isError: false
    };
  }

  private request(path: string, init: RequestInit = {}) {
    return this.requestApp(`/api/app/v1/work/chat${path}`, init);
  }

  private requestApp(path: string, init: RequestInit = {}) {
    return this.options.apiClient.request(path, init, "required");
  }

  private async recordModelUsage(
    record: Omit<LocalApiGatewayUsage, "id" | "createdAt">
  ): Promise<void> {
    if (!this.options.recordUsage) return;
    await this.options.recordUsage({
      ...record,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    }).catch(() => undefined);
  }

  private async getAgent(
    agentId: string,
    requestedRevision: number,
    signal: AbortSignal
  ): Promise<DesktopAgentProfile> {
    const response = await this.requestApp(
      `/api/app/v1/work/agents/${encodeURIComponent(agentId)}`,
      { signal }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const catalogAgent = this.catalogAgents.get(agentId);
      const responseError = new ProjectChatResponseError(
        readResponseError(payload, response.status),
        response.status
      );
      if (
        (response.status === 404 || isProjectChatAuthenticationError(responseError)) &&
        catalogAgent?.origin === "template" &&
        catalogAgent.forkSourceId === null &&
        catalogAgent.revision === requestedRevision
      ) {
        return catalogAgent;
      }
      throw responseError;
    }
    const agent = normalizeAgent(payload, this.options.apiClient.origin);
    if (!agent) throw new Error("RouteMarket returned an invalid Agent profile.");
    if (agent.revision !== requestedRevision) {
      const versionResponse = await this.requestApp(
        `/api/app/v1/work/agents/${encodeURIComponent(agentId)}/versions/${requestedRevision}`,
        { signal }
      );
      const versionPayload = await versionResponse.json().catch(() => null);
      if (!versionResponse.ok) {
        throw new Error(readResponseError(versionPayload, versionResponse.status));
      }
      const versionedAgent = normalizeAgentVersion(
        versionPayload,
        agent,
        this.options.apiClient.origin
      );
      if (!versionedAgent) {
        throw new Error("RouteMarket returned an invalid Agent version snapshot.");
      }
      return versionedAgent;
    }
    return agent;
  }
}

export function buildStoredChatHistory(
  messages: LocalProjectChatMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const content = message.role === "user" && message.attachments?.length
      ? buildAttachmentMessageContent(message.content, message.attachments) as string
      : message.content;
    history.push({
      role: message.role,
      content: message.role === "assistant" && (message.stopped || message.failed)
        ? [content, message.stopped
            ? "[This response was stopped by the user. Do not resume or repeat that request unless the user asks again.]"
            : "[This response failed. Do not retry or repeat that request unless the user asks again.]"]
            .filter(Boolean)
            .join("\n\n")
        : content
    });
    if (
      message.role === "user" &&
      (index === messages.length - 1 || messages[index + 1]?.role !== "assistant")
    ) {
      history.push({
        role: "assistant",
        content: "[This request was interrupted before a response was recorded. Do not resume or repeat it unless the user asks again.]"
      });
    }
  }
  return history;
}

function isTransientCatalogStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isTransientCatalogFailure(error: unknown): boolean {
  return error instanceof TypeError || (
    error instanceof ProjectChatResponseError && isTransientCatalogStatus(error.status)
  );
}

function normalizeModel(value: unknown, apiOrigin: string): ChatModel | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Record<string, unknown>;
  const category = model.category;
  if (
    typeof model.code !== "string" ||
    typeof model.display_name !== "string" ||
    (category !== "chat" && category !== "reasoning")
  ) {
    return null;
  }
  const platformPricing = normalizePlatformModelPricing(model);
  return {
    code: model.code,
    displayName: model.display_name,
    iconUrl: normalizeCatalogAssetUrl(
      model.icon_url ?? (model.icon_storage_provider === "public" ? model.icon_storage_key : null),
      apiOrigin
    ),
    iconStorageProvider: normalizeIconStorageProvider(model.icon_storage_provider),
    iconStorageKey: typeof model.icon_storage_key === "string" ? model.icon_storage_key : null,
    source: "routemarket",
    providerId: null,
    providerName: "RouteMarket",
    category,
    supportsTools: model.supports_tools === true,
    supportsNativeWebSearch: model.supports_native_web_search === true,
    supportsVision: model.supports_vision === true,
    supportsStream: model.supports_stream === true,
    supportsReasoningSummary: model.supports_reasoning_controls === true,
    preferredChatProtocol:
      model.preferred_chat_protocol === "openai_responses"
        ? "openai_responses"
        : null,
    ...(platformPricing ? { platformPricing } : {})
  };
}

function normalizePlatformModelPricing(
  model: Record<string, unknown>
): NonNullable<ChatModel["platformPricing"]> | null {
  const primaryCredit = typeof model.picker_primary_price === "number" &&
    Number.isFinite(model.picker_primary_price) && model.picker_primary_price >= 0
    ? model.picker_primary_price
    : null;
  const components = (Array.isArray(model.picker_price_components)
    ? model.picker_price_components
    : []).flatMap((value) => {
      const component = asRecord(value);
      if (
        !component ||
        typeof component.sale_price !== "number" ||
        !Number.isFinite(component.sale_price) ||
        component.sale_price < 0
      ) return [];
      return [{
        displayName: typeof component.display_name === "string" && component.display_name.trim()
          ? component.display_name.trim().slice(0, 120)
          : typeof component.billing_metric === "string"
            ? component.billing_metric.slice(0, 120)
            : "Credit",
        billingMetric: typeof component.billing_metric === "string"
          ? component.billing_metric.slice(0, 120)
          : "",
        unitLabel: typeof component.unit_label === "string"
          ? component.unit_label.slice(0, 80)
          : "",
        unitSize: typeof component.unit_size === "number" && Number.isFinite(component.unit_size)
          ? Math.max(0, component.unit_size)
          : 1,
        salePrice: component.sale_price
      }];
    }).slice(0, 20);
  return primaryCredit !== null || components.length
    ? { primaryCredit, components }
    : null;
}

function normalizeMediaModel(
  value: unknown,
  expectedCategory: MediaModelCategory,
  apiOrigin: string,
  channelGroups: unknown[]
): MediaModel | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Record<string, unknown>;
  if (
    typeof model.code !== "string" ||
    typeof model.display_name !== "string" ||
    model.category !== expectedCategory
  ) {
    return null;
  }
  const audioModes = Array.isArray(model.audio_modes)
    ? model.audio_modes.filter(
        (mode): mode is MediaModel["audioModes"][number] =>
          mode === "tts" || mode === "stt" || mode === "music" || mode === "sfx"
      )
    : [];
  return {
    code: model.code,
    displayName: model.display_name,
    iconUrl: normalizeCatalogAssetUrl(
      model.icon_url ?? (model.icon_storage_provider === "public" ? model.icon_storage_key : null),
      apiOrigin
    ),
    iconStorageProvider: normalizeIconStorageProvider(model.icon_storage_provider),
    iconStorageKey: typeof model.icon_storage_key === "string" ? model.icon_storage_key : null,
    category: expectedCategory,
    source: "routemarket",
    providerId: null,
    providerName: typeof model.provider_name === "string" && model.provider_name.trim()
      ? model.provider_name.trim()
      : "RouteMarket",
    audioModes,
    price: typeof model.picker_primary_price === "number"
      ? model.picker_primary_price
      : null,
    ...(expectedCategory === "image"
      ? { imageCapabilities: normalizeMediaImageCapabilities(model, channelGroups) }
      : {})
  };
}

function normalizeMediaImageCapabilities(
  model: Record<string, unknown>,
  channelGroups: unknown[]
): MediaImageCapabilities | null {
  const modelCode = typeof model.code === "string" ? model.code : "";
  const defaultGroupIds = new Set(
    (Array.isArray(model.default_group_ids) ? model.default_group_ids : [])
      .filter((value): value is string => typeof value === "string")
  );
  const matchingGroups = channelGroups.flatMap((value) => {
    const group = asRecord(value);
    const logicalModel = asRecord(group?.logical_model);
    return group && logicalModel?.code === modelCode ? [group] : [];
  });
  const selectedGroups = defaultGroupIds.size
    ? matchingGroups.filter((group) => typeof group.id === "string" && defaultGroupIds.has(group.id))
    : matchingGroups;
  const groups = selectedGroups.length ? selectedGroups : matchingGroups;
  const sizes = new Map<string, MediaImageCapabilities["sizes"][number]>();
  const qualities = new Map<string, { value: string; label: string }>();
  const counts = new Set<number>();
  const prices: MediaImageCapabilities["prices"] = [];
  const requestPrices: number[] = [];
  let defaultSize: string | null = null;
  let defaultQuality: string | null = null;
  let defaultCount = 1;

  for (const group of groups) {
    for (const itemValue of Array.isArray(group.items) ? group.items : []) {
      const item = asRecord(itemValue);
      const capabilities = asRecord(item?.image_capabilities);
      if (capabilities) {
        defaultSize ??= readNonEmptyString(capabilities.default_size);
        defaultQuality ??= readNonEmptyString(capabilities.default_quality);
        if (typeof capabilities.default_count === "number" && Number.isFinite(capabilities.default_count)) {
          defaultCount = Math.max(1, Math.floor(capabilities.default_count));
        }

        for (const outputValue of Array.isArray(capabilities.supported_outputs)
          ? capabilities.supported_outputs
          : []) {
          const output = asRecord(outputValue);
          const size = readNonEmptyString(output?.size);
          if (!size || output?.unsupported === true || sizes.has(size)) continue;
          sizes.set(size, {
            value: size,
            label: readNonEmptyString(output?.label) ?? size,
            resolution: readNonEmptyString(output?.resolution),
            ratio: readNonEmptyString(output?.ratio)
          });
        }
        for (const sizeValue of Array.isArray(capabilities.supported_sizes)
          ? capabilities.supported_sizes
          : []) {
          const size = readNonEmptyString(sizeValue);
          if (size && !sizes.has(size)) {
            sizes.set(size, { value: size, label: size, resolution: null, ratio: null });
          }
        }
        for (const qualityValue of Array.isArray(capabilities.supported_qualities)
          ? capabilities.supported_qualities
          : []) {
          const quality = readNonEmptyString(qualityValue);
          if (quality && !qualities.has(quality)) qualities.set(quality, { value: quality, label: quality });
        }
        for (const countValue of Array.isArray(capabilities.supported_counts)
          ? capabilities.supported_counts
          : []) {
          if (typeof countValue === "number" && Number.isFinite(countValue) && countValue >= 1) {
            counts.add(Math.floor(countValue));
          }
        }
        for (const parameterValue of Array.isArray(capabilities.parameters) ? capabilities.parameters : []) {
          const parameter = asRecord(parameterValue);
          const key = readNonEmptyString(parameter?.key)?.toLowerCase();
          if (key !== "size" && key !== "quality") continue;
          if (key === "size") defaultSize ??= readNonEmptyString(parameter?.default_value);
          if (key === "quality") defaultQuality ??= readNonEmptyString(parameter?.default_value);
          for (const optionValue of Array.isArray(parameter?.options) ? parameter.options : []) {
            const option = asRecord(optionValue);
            const optionCode = readNonEmptyString(option?.value);
            if (!optionCode) continue;
            const label = readNonEmptyString(option?.label) ?? optionCode;
            if (key === "size" && !sizes.has(optionCode)) {
              sizes.set(optionCode, { value: optionCode, label, resolution: null, ratio: null });
            } else if (key === "quality") {
              qualities.set(optionCode, { value: optionCode, label });
            }
          }
        }
      }

      for (const componentValue of Array.isArray(item?.price_components) ? item.price_components : []) {
        const component = asRecord(componentValue);
        const metric = readNonEmptyString(component?.billing_metric);
        const salePrice = typeof component?.sale_price === "number" && Number.isFinite(component.sale_price)
          ? component.sale_price
          : null;
        const unitSize = typeof component?.unit_size === "number" && Number.isFinite(component.unit_size) && component.unit_size > 0
          ? component.unit_size
          : 1;
        if (!metric || salePrice === null) continue;
        const unitPrice = salePrice / unitSize;
        if (metric === "request_count") {
          requestPrices.push(unitPrice);
          continue;
        }
        if (!metric.includes("output_items")) continue;
        const attributes = asRecord(component?.attributes);
        prices.push({
          size: readNonEmptyString(attributes?.size),
          quality: readNonEmptyString(attributes?.quality),
          resolution: readNonEmptyString(attributes?.resolution),
          ratio: readNonEmptyString(attributes?.ratio),
          credits: unitPrice
        });
      }
    }
  }

  if (!sizes.size && !qualities.size && !prices.length) return null;
  return {
    sizes: [...sizes.values()],
    qualities: [...qualities.values()],
    counts: [...counts].sort((left, right) => left - right),
    defaultSize,
    defaultQuality,
    defaultCount,
    requestCredits: requestPrices.length ? Math.min(...requestPrices) : 0,
    prices
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildExternalMediaRequestBody(
  input: MediaGenerationRequest,
  modelId: string
): Record<string, unknown> {
  if (input.kind === "image") {
    return {
      model: modelId,
      prompt: input.prompt,
      n: input.count ?? 1,
      response_format: "url",
      ...(input.size ? { size: input.size } : {}),
      ...(input.quality ? { quality: input.quality } : {})
    };
  }
  if (input.kind === "video") {
    return {
      model: modelId,
      prompt: input.prompt,
      response_format: "url",
      ...(input.durationSeconds ? {
        duration: input.durationSeconds,
        duration_seconds: input.durationSeconds
      } : {})
    };
  }
  return {
    model: modelId,
    input: input.prompt,
    voice: input.voice || "alloy",
    format: input.format || "mp3",
    response_format: input.format || "mp3"
  };
}

function buildMediaRequestBody(input: MediaGenerationRequest): Record<string, unknown> {
  const common = {
    model: input.model,
    session_source: "desktop"
  };
  if (input.kind === "image") {
    return {
      ...common,
      prompt: input.prompt,
      n: input.count ?? 1,
      async_mode: true,
      ...(input.size ? { size: input.size } : {}),
      ...(input.quality ? { quality: input.quality } : {})
    };
  }
  if (input.kind === "video") {
    return {
      ...common,
      prompt: input.prompt,
      response_format: "url",
      ...(input.durationSeconds ? { duration_seconds: input.durationSeconds } : {})
    };
  }
  return {
    ...common,
    input: input.prompt,
    response_format: "url",
    format: input.format || "mp3",
    ...(input.voice ? { voice: input.voice } : {})
  };
}

function readTaskId(value: unknown): string | null {
  return readStringField(value, "task_id") ?? readStringField(value, "taskId");
}

function readStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function normalizeMediaOutputs(
  value: unknown,
  kind: MediaModelCategory
): MediaGenerationOutput[] {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const output = root.output && typeof root.output === "object"
    ? root.output as Record<string, unknown>
    : root;
  const result = output.result && typeof output.result === "object"
    ? output.result as Record<string, unknown>
    : output;
  const values = [root.data, output.data, output.outputs, result.data, result.outputs]
    .find(Array.isArray) as unknown[] | undefined;
  const candidates = values ?? [result];
  return candidates.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const mimeType = readStringField(item, "mime_type") ?? readStringField(item, "mimeType");
    const base64 = readStringField(item, "b64_json");
    const url =
      readStringField(item, "preview_url") ??
      readStringField(item, "previewUrl") ??
      readStringField(item, "download_url") ??
      readStringField(item, "downloadUrl") ??
      readStringField(item, "url") ??
      (base64 ? `data:${mimeType ?? defaultMediaMimeType(kind)};base64,${base64}` : null);
    if (!url) return [];
    return [{
      id: readStringField(item, "id") ?? `${kind}-${index + 1}`,
      kind,
      url,
      downloadUrl: readStringField(item, "download_url") ?? readStringField(item, "downloadUrl"),
      thumbnailUrl: readStringField(item, "thumbnail_url") ?? readStringField(item, "thumbnailUrl"),
      mimeType,
      revisedPrompt: readStringField(item, "revised_prompt") ?? readStringField(item, "revisedPrompt")
    }];
  });
}

function defaultMediaMimeType(kind: MediaModelCategory) {
  return kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg";
}

function resolveExternalMediaOutputUrls(
  output: MediaGenerationOutput,
  baseUrl: string
): MediaGenerationOutput {
  const resolveUrl = (value: string | null): string | null => {
    if (!value || /^(?:data|blob):/i.test(value)) return value;
    try {
      return new URL(value, `${baseUrl}/`).toString();
    } catch {
      return value;
    }
  };
  return {
    ...output,
    url: resolveUrl(output.url) ?? output.url,
    downloadUrl: resolveUrl(output.downloadUrl),
    thumbnailUrl: resolveUrl(output.thumbnailUrl)
  };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeCatalogAssetUrl(value: unknown, apiOrigin: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//")) {
    return new URL(url, apiOrigin).toString();
  }
  return url;
}

function normalizeMediaInspirationPost(
  value: unknown,
  expectedKind: MediaModelCategory,
  apiOrigin: string
): MediaInspirationPost | null {
  const post = asRecord(value);
  if (!post || typeof post.id !== "string" || !post.id) return null;
  const kind = post.kind === "image" || post.kind === "video" || post.kind === "audio"
    ? post.kind
    : expectedKind;
  const author = asRecord(post.author);
  const strings = (entry: unknown) => Array.isArray(entry)
    ? entry.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  const count = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry)
    ? Math.max(0, Math.trunc(entry))
    : 0;
  return {
    id: post.id,
    kind,
    title: typeof post.title === "string" && post.title.trim() ? post.title.trim() : null,
    prompt: typeof post.prompt === "string" && post.prompt.trim() ? post.prompt.trim() : null,
    modelCode: typeof post.model_code === "string" ? post.model_code : "",
    modelName: typeof post.model_name === "string" ? post.model_name : "",
    tags: strings(post.tags),
    officialTagCodes: strings(post.official_tag_codes),
    thumbnailUrl: normalizeCatalogAssetUrl(post.thumbnail_url, apiOrigin),
    mediaUrl: normalizeCatalogAssetUrl(post.media_url, apiOrigin),
    mimeType: typeof post.mime_type === "string" ? post.mime_type : null,
    likeCount: count(post.like_count),
    saveCount: count(post.save_count),
    viewCount: count(post.view_count),
    author: author && typeof author.id === "string"
      ? {
          id: author.id,
          name: typeof author.name === "string" && author.name.trim() ? author.name.trim() : "RouteMarket",
          avatarUrl: normalizeCatalogAssetUrl(author.avatar_url, apiOrigin)
        }
      : null
  };
}

function normalizeIconStorageProvider(
  value: unknown
): ChatModel["iconStorageProvider"] {
  return value === "local" || value === "aliyun-oss" || value === "r2" || value === "public"
    ? value
    : null;
}

function normalizeAgent(
  value: unknown,
  apiOrigin: string,
  originOverride?: DesktopAgentProfile["origin"]
): DesktopAgentProfile | null {
  if (!value || typeof value !== "object") return null;
  const agent = value as Record<string, unknown>;
  if (
    typeof agent.id !== "string" ||
    typeof agent.name !== "string" ||
    typeof agent.system_prompt !== "string"
  ) {
    return null;
  }
  return {
    id: agent.id,
    revision: typeof agent.revision === "number" && Number.isInteger(agent.revision)
      ? agent.revision
      : 1,
    origin: originOverride ?? (typeof agent.fork_source_id === "string" ? "template" : "personal"),
    forkSourceId: typeof agent.fork_source_id === "string" ? agent.fork_source_id : null,
    name: agent.name,
    description: typeof agent.description === "string" ? agent.description : null,
    avatarUrl:
      typeof agent.avatar_url === "string"
        ? resolveAgentAvatarUrl(agent.avatar_url, apiOrigin)
        : null,
    systemPrompt: agent.system_prompt,
    greeting: typeof agent.greeting === "string" ? agent.greeting : null,
    starterQuestions: normalizeStringArray(agent.starter_questions),
    tags: normalizeStringArray(agent.tags),
    defaultModelCode:
      typeof agent.default_model_code === "string" ? agent.default_model_code : null,
    skills: Array.isArray(agent.skills)
      ? agent.skills
          .map(normalizeAgentSkill)
          .filter((skill): skill is DesktopAgentProfile["skills"][number] => skill !== null)
      : [],
    toolPermissions: normalizeAgentTools(agent.tool_permissions ?? agent.tools),
    executionPolicy: normalizeExecutionPolicy(agent.execution_policy),
    tools: Array.isArray(agent.tools)
      ? agent.tools
          .map(normalizeAgentTool)
          .filter((tool): tool is DesktopAgentProfile["tools"][number] => tool !== null)
      : [],
    updatedAt: typeof agent.updated_at === "string" ? agent.updated_at : ""
  };
}

function normalizeAgentVersion(
  value: unknown,
  current: DesktopAgentProfile,
  apiOrigin: string
): DesktopAgentProfile | null {
  if (!value || typeof value !== "object") return null;
  const version = value as Record<string, unknown>;
  if (!version.snapshot || typeof version.snapshot !== "object") return null;
  const snapshot = version.snapshot as Record<string, unknown>;
  if (
    typeof version.revision !== "number" ||
    typeof snapshot.name !== "string" ||
    typeof snapshot.systemPrompt !== "string"
  ) {
    return null;
  }
  return {
    id: current.id,
    revision: version.revision,
    origin: current.origin,
    forkSourceId: current.forkSourceId,
    name: snapshot.name,
    description: typeof snapshot.description === "string" ? snapshot.description : null,
    avatarUrl: typeof snapshot.avatarUrl === "string"
      ? resolveAgentAvatarUrl(snapshot.avatarUrl, apiOrigin)
      : null,
    systemPrompt: snapshot.systemPrompt,
    greeting: typeof snapshot.greeting === "string" ? snapshot.greeting : null,
    starterQuestions: normalizeStringArray(snapshot.starterQuestions),
    tags: normalizeStringArray(snapshot.tags),
    defaultModelCode: typeof snapshot.defaultModelCode === "string"
      ? snapshot.defaultModelCode
      : null,
    skills: Array.isArray(snapshot.skills)
      ? snapshot.skills
          .map(normalizeAgentSkill)
          .filter((skill): skill is DesktopAgentProfile["skills"][number] => skill !== null)
      : [],
    toolPermissions: normalizeAgentTools(snapshot.toolPermissions ?? snapshot.tools),
    executionPolicy: normalizeExecutionPolicy(snapshot.executionPolicy),
    tools: Array.isArray(snapshot.tools)
      ? snapshot.tools
          .map(normalizeAgentTool)
          .filter((tool): tool is DesktopAgentProfile["tools"][number] => tool !== null)
      : [],
    updatedAt: typeof version.created_at === "string" ? version.created_at : current.updatedAt
  };
}

function resolveAgentAvatarUrl(value: string, apiOrigin: string): string {
  if (!value.startsWith("/")) return value;
  return new URL(value, apiOrigin).toString();
}

function normalizeAgentTool(
  value: unknown
): DesktopAgentProfile["tools"][number] | null {
  if (!value || typeof value !== "object") return null;
  const tool = value as Record<string, unknown>;
  if (typeof tool.type !== "string" || !tool.type.trim()) return null;
  return {
    type: tool.type,
    ...(typeof tool.serverId === "string" ? { serverId: tool.serverId } : {}),
    ...(typeof tool.credentialId === "string"
      ? { credentialId: tool.credentialId }
      : {})
  };
}

function normalizeAgentTools(value: unknown): DesktopAgentProfile["toolPermissions"] {
  return Array.isArray(value)
    ? value
        .map(normalizeAgentTool)
        .filter((tool): tool is DesktopAgentProfile["tools"][number] => tool !== null)
    : [];
}

function normalizeAgentSkill(
  value: unknown
): DesktopAgentProfile["skills"][number] | null {
  if (!value || typeof value !== "object") return null;
  const skill = value as Record<string, unknown>;
  const skillId = typeof skill.skillId === "string"
    ? skill.skillId
    : typeof skill.skill_id === "string" ? skill.skill_id : "";
  if (!skillId.trim()) return null;
  const source = skill.source === "local" ? "local" : "cloud";
  return {
    skillId,
    ...(typeof skill.name === "string" ? { name: skill.name } : {}),
    ...(typeof skill.version === "number" || typeof skill.version === "string"
      ? { version: skill.version }
      : {}),
    source,
    enabled: skill.enabled !== false
  };
}

function normalizeExecutionPolicy(
  value: unknown
): DesktopAgentProfile["executionPolicy"] {
  const policy = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const environment = policy.environment === "local" || policy.environment === "cloud"
    ? policy.environment
    : "auto";
  const approvalMode = policy.approvalMode === "always_ask" || policy.approval_mode === "always_ask"
    ? "always_ask"
    : policy.approvalMode === "never_ask" || policy.approval_mode === "never_ask"
      ? "never_ask"
      : "risky_only";
  return { environment, approvalMode };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function buildSystemPrompt(
  input: ProjectChatRequest,
  agent: DesktopAgentProfile | null = null,
  localSkillToolsEnabled = true
) {
  const hasProject = Boolean(input.project);
  const hasFolder = Boolean(input.project && input.project.hasFolder !== false);
  const executionEnvironment = resolveExecutionEnvironment(input);
  const lines = [
    hasProject
      ? "You are RouteMarket Work, an AI collaborator operating inside a desktop project."
      : "You are RouteMarket Work, an AI collaborator in a general desktop conversation.",
    ...(input.project ? [`Current project: ${input.project.displayName} (${input.project.localProjectId}).`] : [
      "This conversation is not linked to a project. Do not imply that project files, processes, Skills, or local project tools are available."
    ]),
    `Execution environment: ${executionEnvironment}.`,
    "Do not claim that you changed files, ran commands, or used local tools unless a later tool result explicitly confirms it."
  ];
  if (hasFolder) {
    lines.push(
      "This project is linked to a local folder. Prefer its supplied file context and project tools when relevant.",
      "Use the supplied project tools to inspect the project instead of guessing file contents or paths.",
      "Before modifying an existing file, read it and use the returned sha256 for the guarded write.",
      "When the user requests spreadsheet work, use the spreadsheet tool with an explicit operation: create, inspect, read_range, write_range, or export_csv. Inspect or read the workbook first, then pass the returned sha256 as expected_sha256 before write_range. Do not create helper scripts or start a process for spreadsheet work.",
      "When the user requests a PDF, use the pdf tool with operation create and include the complete document content. Do not create helper scripts, search for PDF libraries, or start a project process for PDF work.",
      "Files returned by a tool in output_files are automatically attached to the assistant response. Briefly mention the generated filename after the tool succeeds.",
      "When running a project command, pass the executable and arguments separately. Inspect project processes after starting a long-running service, and stop only processes returned for this project."
    );
  } else if (hasProject) {
    lines.push("This project is not linked to a local folder. Do not imply that local project files or project tools are available.");
  }
  if (agent) {
    lines.push(
      `You are operating as the RouteMarket Agent profile "${agent.name}" (${agent.id}).`,
      "Follow the Agent profile instructions below subject to platform safety, project boundaries, local Tool permissions, and approval policy:",
      `<agent-profile id="${escapeMarkupAttribute(agent.id)}">`,
      agent.systemPrompt,
      "</agent-profile>"
    );
    if (agent.tools.length) {
      lines.push(
        `The Agent profile also has ${agent.tools.length} RouteMarket cloud tool configuration(s). Only tools explicitly supplied in this request are callable from the desktop runtime.`
      );
    }
    const agentSkills = resolveDesktopAgentSkillAvailability(
      agent.skills,
      input.projectContext ?? null,
      {
        executionEnvironment: resolveExecutionEnvironment(input),
        localSkillToolsEnabled
      }
    );
    const availableAgentSkills = agentSkills.filter((item) => item.available);
    if (availableAgentSkills.length) {
      lines.push(
        "The Agent profile explicitly enables these project-local Skills. Invoke their matching local Skill tools when the current task calls for them:",
        ...availableAgentSkills.map((item) =>
          `- ${item.skill.name || item.skill.skillId} (${item.skill.skillId})`
        )
      );
    }
    const unavailableAgentSkills = agentSkills.filter((item) => !item.available);
    if (unavailableAgentSkills.length) {
      lines.push(
        "These Agent profile Skills are not callable in the current Desktop runtime. Do not claim to have used them:",
        ...unavailableAgentSkills.map((item) =>
          `- ${item.skill.name || item.skill.skillId} (${item.skill.skillId}): ${item.reason}`
        )
      );
    }
  }
  const context = input.projectContext;
  if (context?.instructions) {
    lines.push(
      "The following project-owned AGENTS.md instructions apply subject to platform safety and approval policy:",
      `<project-instructions path="${escapeMarkupAttribute(context.instructions.relativePath)}">`,
      context.instructions.text,
      "</project-instructions>"
    );
    if (context.instructions.truncated) lines.push("[Project instructions were truncated locally.]");
  }
  if (context?.skills.length) {
    lines.push(
      "Project-local Skills available through the local Skill Runtime. Invoke the matching Skill tool when its guidance is relevant, then use the available local Tools for concrete actions:",
      ...context.skills.map((skill) =>
        `- ${skill.name} (${skill.id}): ${skill.description || "No description"}`
      )
    );
  }
  if (input.projectSkill) {
    lines.push(
      "The user explicitly selected the following project-owned Skill for this request. Follow it subject to platform safety, project boundaries, and local approval policy:",
      `<project-skill id="${escapeMarkupAttribute(input.projectSkill.id)}" path="${escapeMarkupAttribute(input.projectSkill.relativePath)}">`,
      input.projectSkill.text,
      "</project-skill>"
    );
    if (input.projectSkill.truncated) lines.push("[Project Skill instructions were truncated locally.]");
  }
  return lines.join("\n");
}

function resolveExecutionEnvironment(
  input: ProjectChatRequest
): "local" | "cloud" {
  const requested = input.agent?.executionEnvironment ?? "auto";
  if (requested === "local" || requested === "cloud") return requested;
  return !input.project || input.project.hasFolder === false ? "cloud" : "local";
}

function clampToolRounds(value: number): number {
  if (!Number.isFinite(value)) return MAX_TOOL_ROUNDS;
  return Math.max(1, Math.min(MAX_TOOL_ROUNDS, Math.trunc(value)));
}

function filterTools(
  tools: ProjectChatToolDefinition[],
  groups?: AgentLocalToolGroup[],
  permissions: DesktopAgentProfile["toolPermissions"] = []
): ProjectChatToolDefinition[] {
  const allowed = groups ? new Set(groups) : null;
  const permissionTypes = new Set(permissions.map((permission) => permission.type));
  const localPermissionTypes = new Set([
    "files",
    "project_files",
    "processes",
    "browser",
    "mcp",
    "skills",
    "skill"
  ]);
  const hasLocalPermissionPolicy = permissions.some(
    (permission) => {
      const type = permission.type;
      // A cloud MCP binding is not a declaration that local MCP is the only
      // desktop capability allowed. Local MCP bindings have no cloud server id
      // (or use an explicitly local id).
      if (
        type === "mcp" &&
        permission.serverId &&
        !permission.serverId.startsWith("local")
      ) {
        return false;
      }
      return localPermissionTypes.has(type) ||
      type.startsWith("project_") ||
      type.startsWith("browser_") ||
      type.startsWith("mcp_local_") ||
      type.startsWith("skill_local_");
    }
  );
  return tools.filter((tool) => {
    const name = tool.function.name;
    const group: AgentLocalToolGroup = name.startsWith("mcp_local_")
      ? "mcp"
      : name.startsWith("skill_local_")
        ? "skills"
        : name.startsWith("browser_")
          ? "browser"
          : name === "project_start_process" ||
              name === "project_list_processes" ||
              name === "project_stop_process"
            ? "processes"
            : "files";
    if (allowed && !allowed.has(group)) return false;
    if (!hasLocalPermissionPolicy) return true;
    if (permissionTypes.has(name) || permissionTypes.has(group)) return true;
    if (group === "files" && permissionTypes.has("project_files")) return true;
    if (group === "skills" && permissionTypes.has("skill")) return true;
    if (group === "mcp" && permissionTypes.has("mcp")) return true;
    return false;
  });
}

function escapeMarkupAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function dedupeArtifacts<T extends { id: string; relativePath: string }>(artifacts: T[]): T[] {
  const byPath = new Map<string, T>();
  for (const artifact of artifacts) {
    if (!byPath.has(artifact.relativePath)) byPath.set(artifact.relativePath, artifact);
  }
  return [...byPath.values()];
}

function buildMessageContent(input: ProjectChatRequest) {
  const sections: string[] = [];
  if (input.contextFile) {
    sections.push([
      `Local file context: ${input.contextFile.relativePath}`,
      `URI: ${input.contextFile.uri}`,
      "```",
      input.contextFile.text,
      "```",
      input.contextFile.truncated
        ? "[The local file preview was truncated.]"
        : ""
    ].filter(Boolean).join("\n"));
  }
  const attachmentContent = buildAttachmentMessageContent(
    input.message,
    input.attachments ?? [],
    input.modelSupportsVision === true
  );
  if (typeof attachmentContent !== "string") {
    const prefix = sections.join("\n\n");
    if (prefix) {
      const first = attachmentContent[0];
      if (first?.type === "text") {
        first.text = `${prefix}\n\n${first.text}`;
      } else {
        attachmentContent.unshift({ type: "text", text: prefix });
      }
    }
    return attachmentContent;
  }
  sections.push(attachmentContent);
  return sections.filter(Boolean).join("\n\n");
}

function toAnthropicMessages(
  input: ProjectChatRequest,
  extraMessages: Record<string, unknown>[]
): Array<{ role: "user" | "assistant"; content: unknown }> {
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...(input.history ?? []).map((message) => ({
      role: message.role,
      content: message.content
    })),
    { role: "user", content: anthropicTextContent(buildMessageContent(input)) }
  ];

  for (const message of extraMessages) {
    if (message.role === "assistant") {
      const blocks: Record<string, unknown>[] = [];
      if (typeof message.content === "string" && message.content) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const value of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        const call = asRecord(value);
        const fn = asRecord(call?.function);
        if (!fn || typeof fn.name !== "string") continue;
        blocks.push({
          type: "tool_use",
          id: typeof call?.id === "string" ? call.id : "",
          name: fn.name,
          input: parseJsonObject(typeof fn.arguments === "string" ? fn.arguments : "{}")
        });
      }
      messages.push({ role: "assistant", content: blocks });
      continue;
    }
    if (message.role === "user") {
      const blocks = anthropicUserContent(message.content);
      if (!blocks.length) continue;
      const previous = messages.at(-1);
      if (previous?.role === "user" && Array.isArray(previous.content)) {
        previous.content.push(...blocks);
      } else {
        messages.push({ role: "user", content: blocks });
      }
      continue;
    }
    if (message.role !== "tool") continue;
    const block = {
      type: "tool_result",
      tool_use_id: typeof message.tool_call_id === "string" ? message.tool_call_id : "",
      content: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")
    };
    const previous = messages.at(-1);
    if (previous?.role === "user" && Array.isArray(previous.content)) {
      previous.content.push(block);
    } else {
      messages.push({ role: "user", content: [block] });
    }
  }
  return messages;
}

function toOpenAiResponsesInput(
  input: ProjectChatRequest,
  extraMessages: Record<string, unknown>[]
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [
    ...(input.history ?? []).map((message) => ({
      role: message.role,
      content: message.content
    })),
    {
      role: "user",
      content: toOpenAiResponsesUserContent(buildMessageContent(input))
    }
  ];

  for (const message of extraMessages) {
    if (message.role === "assistant") {
      if (typeof message.content === "string" && message.content) {
        items.push({ role: "assistant", content: message.content });
      }
      for (const value of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        const call = asRecord(value);
        const fn = asRecord(call?.function);
        if (!fn || typeof fn.name !== "string") continue;
        items.push({
          type: "function_call",
          call_id: typeof call?.id === "string" ? call.id : "",
          name: fn.name,
          arguments: typeof fn.arguments === "string" ? fn.arguments : "{}"
        });
      }
      continue;
    }
    if (message.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: typeof message.tool_call_id === "string" ? message.tool_call_id : "",
        output: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")
      });
      continue;
    }
    if (message.role === "user") {
      items.push({ role: "user", content: toOpenAiResponsesUserContent(message.content) });
    }
  }
  return items;
}

function toOpenAiResponsesUserContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content.flatMap((value): Record<string, unknown>[] => {
    const block = asRecord(value);
    if (block?.type === "text" && typeof block.text === "string") {
      return [{ type: "input_text", text: block.text }];
    }
    const image = asRecord(block?.image_url);
    if (block?.type === "image_url" && typeof image?.url === "string") {
      return [{ type: "input_image", image_url: image.url, detail: "auto" }];
    }
    return [];
  });
}

function anthropicTextContent(
  content: ReturnType<typeof buildMessageContent>
): string {
  if (typeof content === "string") return content;
  return content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n");
}

function readToolImages(execution: ProjectChatToolExecution): string[] {
  return (execution.images ?? []).filter((value) => (
    typeof value === "string"
    && value.length <= 200_000
    && /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value)
  ));
}

function anthropicUserContent(content: unknown): Record<string, unknown>[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: Record<string, unknown>[] = [];
  for (const value of content) {
    const part = asRecord(value);
    if (part?.type === "text" && typeof part.text === "string" && part.text) {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    if (part?.type !== "image_url") continue;
    const imageUrl = asRecord(part.image_url)?.url;
    if (typeof imageUrl !== "string") continue;
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(imageUrl);
    if (!match) continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: match[1],
        data: match[2]
      }
    });
  }
  return blocks;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readAnthropicStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (text: string) => void
): Promise<{ text: string; reasoning: string; toolCalls: ProjectChatToolCall[]; usage: ModelTokenUsage }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const tools = new Map<number, { id: string; name: string; arguments: string }>();
  let text = "";
  let buffer = "";
  let usage = emptyModelTokenUsage();
  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = asRecord(parseJsonValue(trimmed.slice(5).trim()));
    if (!payload) return;
    usage = mergeModelTokenUsage(usage, extractModelTokenUsage(payload));
    const index = typeof payload.index === "number" ? payload.index : 0;
    const block = asRecord(payload.content_block);
    const delta = asRecord(payload.delta);
    if (payload.type === "content_block_start" && block?.type === "tool_use") {
      tools.set(index, {
        id: typeof block.id === "string" ? block.id : "",
        name: typeof block.name === "string" ? block.name : "",
        arguments: ""
      });
    }
    if (payload.type === "content_block_start" && block?.type === "text" && typeof block.text === "string") {
      text += block.text;
      onText(text);
    }
    if (payload.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
      text += delta.text;
      onText(text);
    }
    if (payload.type === "content_block_delta" && delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
      const tool = tools.get(index);
      if (tool) tool.arguments += delta.partial_json;
    }
  };
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally {
    reader.releaseLock();
  }
  return {
    text,
    reasoning: "",
    toolCalls: [...tools.values()].map((tool) => ({
      ...tool,
      arguments: tool.arguments || "{}"
    })).filter((tool) => tool.name),
    usage
  };
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function buildAttachmentMessageContent(
  message: string,
  attachments: DesktopChatAttachment[],
  supportsVision = false
): string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
> {
  if (!attachments.length) return message;
  const lines = attachments.map((attachment, index) => [
    `${index + 1}. ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes)`,
    `URL: ${attachment.downloadUrl}`,
    attachment.textExcerpt
      ? `Excerpt:\n${attachment.textExcerpt}`
      : ""
  ].filter(Boolean).join("\n"));
  const text = [
    message,
    `The user explicitly attached ${attachments.length} file(s):`,
    ...lines
  ].filter(Boolean).join("\n\n");
  const images = supportsVision
    ? attachments.filter(
        (attachment) =>
          attachment.kind === "image" && attachment.downloadUrl
      )
    : [];
  if (!images.length) return text;
  return [
    { type: "text" as const, text },
    ...images.map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: attachment.downloadUrl }
    }))
  ];
}

function appendRoundText(existing: string, roundText: string): string {
  if (!roundText) return existing;
  if (!existing) return roundText;
  const separator = existing.endsWith("\n") || roundText.startsWith("\n") ? "" : "\n\n";
  return `${existing}${separator}${roundText}`;
}

function formatToolPreview(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.stringify(redactCloudData(JSON.parse(trimmed)), null, 2).slice(0, 4_000);
  } catch {
    return redactCloudText(trimmed).slice(0, 4_000);
  }
}

function roundRequestId(requestId: string, round: number): string {
  return round === 0 ? requestId : `${requestId}_tool_round_${round}`;
}

function normalizeToolCalls(
  calls: ProjectChatToolCall[],
  requestId: string,
  round: number
): ProjectChatToolCall[] {
  return calls.map((call, index) => ({
    ...call,
    id: call.id || `call_${requestId}_${round}_${index}`
  }));
}

function toTranscriptToolCall(call: ProjectChatToolCall) {
  return {
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: call.arguments || "{}"
    }
  };
}

function readResponseError(payload: unknown, status: number) {
  const message = readNestedErrorMessage(payload);
  if (message) return message;
  return `RouteMarket Work chat request failed (${status}).`;
}

function readNestedErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.message)) return String(record.message[0] ?? "").trim();
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return readNestedErrorMessage(record.error);
}
