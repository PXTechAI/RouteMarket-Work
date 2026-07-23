import type {
  AgentLocalToolGroup,
  ChatModel,
  DesktopAgentProfile,
  ProjectChatEvent,
  ProjectChatRequest
} from "../shared/desktop-api";
import { resolveDesktopAgentSkillAvailability } from "../shared/agent-skill-availability";
import { readProjectChatStream } from "./project-chat-stream";
import type { RouteMarketApiClient } from "./routemarket-api-client";
import type { ProjectChatToolRunner } from "./project-chat-tool-runner";
import {
  PROJECT_CHAT_TOOLS,
  projectChatToolTitle,
  type ProjectChatToolCall,
  type ProjectChatToolDefinition
} from "./project-chat-tools";

type ProjectChatClientOptions = {
  apiClient: RouteMarketApiClient;
  onEvent(event: ProjectChatEvent): void;
  toolRunner?: Pick<ProjectChatToolRunner, "execute"> & {
    listTools?: ProjectChatToolRunner["listTools"];
  };
};

type ModelsResponse = {
  items?: unknown[];
};

type AgentsResponse = {
  items?: unknown[];
};

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CALLS = 24;

export class ProjectChatClient {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(private readonly options: ProjectChatClientOptions) {}

  async listModels(): Promise<ChatModel[]> {
    const response = await this.request("/models?purpose=chat");
    const payload = (await response.json().catch(() => null)) as ModelsResponse | null;
    if (!response.ok) {
      throw new Error(readResponseError(payload, response.status));
    }
    return (Array.isArray(payload?.items) ? payload.items : [])
      .map(normalizeModel)
      .filter((model): model is ChatModel => model !== null);
  }

  async listAgents(): Promise<DesktopAgentProfile[]> {
    const response = await this.requestApp("/api/app/v1/agents");
    const payload = (await response.json().catch(() => null)) as AgentsResponse | null;
    if (!response.ok) {
      throw new Error(readResponseError(payload, response.status));
    }
    return (Array.isArray(payload?.items) ? payload.items : [])
      .map((agent) => normalizeAgent(agent, this.options.apiClient.origin))
      .filter((agent): agent is DesktopAgentProfile => agent !== null);
  }

  async send(input: ProjectChatRequest): Promise<void> {
    if (this.activeRequests.has(input.requestId)) {
      throw new Error("This chat request is already running.");
    }

    const controller = new AbortController();
    this.activeRequests.set(input.requestId, controller);
    let content = "";

    try {
      const agent = input.agent
        ? await this.getAgent(
            input.agent.agentId,
            input.agent.agentRevision,
            controller.signal
          )
        : null;
      const executionEnvironment = resolveExecutionEnvironment(input);
      const availableTools = executionEnvironment === "cloud" || input.project.hasFolder === false
        ? []
        : this.options.toolRunner?.listTools
          ? await this.options.toolRunner.listTools(input.project.localProjectId)
          : PROJECT_CHAT_TOOLS;
      const tools = filterTools(
        availableTools,
        input.agent?.localToolGroups,
        agent?.toolPermissions
      );
      const extraMessages: Record<string, unknown>[] = [];
      let toolCallCount = 0;
      let completed = false;
      const maxToolRounds = input.agent
        ? clampToolRounds(input.agent.maxToolRounds)
        : MAX_TOOL_ROUNDS;

      for (let round = 0; round < maxToolRounds; round += 1) {
        const contentBeforeRound = content;
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
          }
        );
        content = appendRoundText(contentBeforeRound, result.text);

        if (!result.toolCalls.length) {
          completed = true;
          break;
        }
        if (!this.options.toolRunner) {
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

        for (const call of calls) {
          const title = projectChatToolTitle(call.name);
          this.options.onEvent({
            requestId: input.requestId,
            type: "tool_started",
            toolCallId: call.id,
            toolName: call.name,
            title
          });
          const execution = await this.options.toolRunner.execute(
            input.project.localProjectId,
            call,
            controller.signal,
            {
              source: input.agent ? "agent" : "chat",
              approvalMode: agent?.executionPolicy.approvalMode ?? "risky_only"
            }
          );
          if (execution.isError) {
            this.options.onEvent({
              requestId: input.requestId,
              type: "tool_error",
              toolCallId: call.id,
              toolName: call.name,
              title,
              message: execution.summary
            });
          } else {
            this.options.onEvent({
              requestId: input.requestId,
              type: "tool_completed",
              toolCallId: call.id,
              toolName: call.name,
              title,
              summary: execution.summary
            });
          }
          extraMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: execution.content
          });
        }
      }

      if (!completed) {
        throw new Error("The local Tool loop reached its maximum number of rounds.");
      }

      this.options.onEvent({
        requestId: input.requestId,
        type: controller.signal.aborted ? "stopped" : "complete",
        content
      });
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
          message: error instanceof Error ? error.message : "Unknown chat error"
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
    onText: (text: string) => void
  ) {
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
        tools,
        tool_choice: "auto",
        parallel_tool_calls: false,
        stream: true
      })
    });

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new Error(readResponseError(payload, response.status));
    }
    return readProjectChatStream(response.body, signal, onText);
  }

  private request(path: string, init: RequestInit = {}) {
    return this.requestApp(`/api/app/v1/work/chat${path}`, init);
  }

  private requestApp(path: string, init: RequestInit = {}) {
    return this.options.apiClient.request(path, init, "required");
  }

  private async getAgent(
    agentId: string,
    requestedRevision: number,
    signal: AbortSignal
  ): Promise<DesktopAgentProfile> {
    const response = await this.requestApp(
      `/api/app/v1/agents/${encodeURIComponent(agentId)}`,
      { signal }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readResponseError(payload, response.status));
    }
    const agent = normalizeAgent(payload, this.options.apiClient.origin);
    if (!agent) throw new Error("RouteMarket returned an invalid Agent profile.");
    if (agent.revision !== requestedRevision) {
      const versionResponse = await this.requestApp(
        `/api/app/v1/agents/${encodeURIComponent(agentId)}/versions/${requestedRevision}`,
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

function normalizeModel(value: unknown): ChatModel | null {
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
  return {
    code: model.code,
    displayName: model.display_name,
    category,
    supportsTools: model.supports_tools === true,
    supportsVision: model.supports_vision === true,
    supportsStream: model.supports_stream === true
  };
}

function normalizeAgent(
  value: unknown,
  apiOrigin: string
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
  const hasFolder = input.project.hasFolder !== false;
  const executionEnvironment = resolveExecutionEnvironment(input);
  const lines = [
    "You are RouteMarket Work, an AI collaborator operating inside a desktop project.",
    `Current project: ${input.project.displayName} (${input.project.localProjectId}).`,
    `Execution environment: ${executionEnvironment}.`,
    "Do not claim that you changed files, ran commands, or used local tools unless a later tool result explicitly confirms it."
  ];
  if (hasFolder) {
    lines.push(
      "This project is linked to a local folder. Prefer its supplied file context and project tools when relevant.",
      "Use the supplied project tools to inspect the project instead of guessing file contents or paths.",
      "Before modifying an existing file, read it and use the returned sha256 for the guarded write.",
      "When running a project command, pass the executable and arguments separately. Inspect project processes after starting a long-running service, and stop only processes returned for this project."
    );
  } else {
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
  return input.project.hasFolder === false ? "cloud" : "local";
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

function buildMessageContent(input: ProjectChatRequest) {
  if (!input.contextFile) return input.message;
  const truncationNote = input.contextFile.truncated
    ? "\n[The local file preview was truncated.]"
    : "";
  return [
    `Local file context: ${input.contextFile.relativePath}`,
    `URI: ${input.contextFile.uri}`,
    "```",
    input.contextFile.text,
    "```",
    truncationNote,
    "",
    "User request:",
    input.message
  ].join("\n");
}

function appendRoundText(existing: string, roundText: string): string {
  if (!roundText) return existing;
  if (!existing) return roundText;
  const separator = existing.endsWith("\n") || roundText.startsWith("\n") ? "" : "\n\n";
  return `${existing}${separator}${roundText}`;
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
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) return String(message[0] ?? "");
    if (typeof message === "string" && message.trim()) return message;
  }
  return `RouteMarket Work chat request failed (${status}).`;
}
