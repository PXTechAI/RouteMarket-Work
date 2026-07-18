import type {
  ChatModel,
  ProjectChatEvent,
  ProjectChatRequest
} from "../shared/desktop-api";
import { readProjectChatStream } from "./project-chat-stream";
import type { ProjectChatToolRunner } from "./project-chat-tool-runner";
import {
  PROJECT_CHAT_TOOLS,
  projectChatToolTitle,
  type ProjectChatToolCall
} from "./project-chat-tools";

type ProjectChatClientOptions = {
  apiBaseUrl: string;
  getAccessToken(): string | undefined;
  onEvent(event: ProjectChatEvent): void;
  toolRunner?: Pick<ProjectChatToolRunner, "execute">;
};

type ModelsResponse = {
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

  async send(input: ProjectChatRequest): Promise<void> {
    if (this.activeRequests.has(input.requestId)) {
      throw new Error("This chat request is already running.");
    }

    const controller = new AbortController();
    this.activeRequests.set(input.requestId, controller);
    let content = "";

    try {
      await this.prepareSession(input, controller.signal);
      const extraMessages: Record<string, unknown>[] = [];
      let toolCallCount = 0;
      let completed = false;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const contentBeforeRound = content;
        const result = await this.requestModelRound(
          input,
          extraMessages,
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
            controller.signal
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

      await this.persistTurn(input, content, controller.signal);
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
    extraMessages: Record<string, unknown>[],
    round: number,
    signal: AbortSignal,
    onText: (text: string) => void
  ) {
    const response = await this.request("", {
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
        system_prompt: buildSystemPrompt(input),
        message: {
          role: "user",
          content: buildMessageContent(input)
        },
        tools: PROJECT_CHAT_TOOLS,
        tool_choice: "auto",
        parallel_tool_calls: false,
        ...(extraMessages.length ? { extra_messages: extraMessages } : {}),
        stream: true
      })
    });

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new Error(readResponseError(payload, response.status));
    }
    return readProjectChatStream(response.body, signal, onText);
  }

  private async prepareSession(input: ProjectChatRequest, signal: AbortSignal) {
    const response = await this.request("/sessions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session_id: input.sessionId,
        title: input.project.displayName,
        model_code: input.model,
        system_prompt: buildSystemPrompt(input)
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(readResponseError(payload, response.status));
    }
  }

  private async persistTurn(
    input: ProjectChatRequest,
    content: string,
    signal: AbortSignal
  ) {
    const response = await this.request(
      `/sessions/${encodeURIComponent(input.sessionId)}/turns`,
      {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_message: {
            id: `user:${input.requestId}`,
            role: "user",
            content: buildMessageContent(input),
            sentAt: input.sentAt
          },
          assistant_message: {
            id: `assistant:${input.requestId}`,
            role: "assistant",
            content,
            sentAt: input.sentAt
          }
        })
      }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(readResponseError(payload, response.status));
    }
  }

  private request(path: string, init: RequestInit = {}) {
    const accessToken = this.options.getAccessToken();
    if (!accessToken) {
      throw new Error("Sign in to RouteMarket before starting a chat.");
    }
    return fetch(`${this.options.apiBaseUrl}/api/app/v1/work/chat${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...init.headers
      }
    });
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

function buildSystemPrompt(input: ProjectChatRequest) {
  const lines = [
    "You are RouteMarket Work, an AI collaborator operating inside a local desktop project.",
    `Current project: ${input.project.displayName} (${input.project.localProjectId}).`,
    "Use the supplied local file context when relevant.",
    "Use the supplied project tools to inspect the project instead of guessing file contents or paths.",
    "Before modifying an existing file, read it and use the returned sha256 for the guarded write.",
    "When running a project command, pass the executable and arguments separately. Inspect project processes after starting a long-running service, and stop only processes returned for this project.",
    "Do not claim that you changed files, ran commands, or used local tools unless a later tool result explicitly confirms it."
  ];
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
      "Project-local Skills available on this device (metadata only; invocation still requires the local Tool Broker):",
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
