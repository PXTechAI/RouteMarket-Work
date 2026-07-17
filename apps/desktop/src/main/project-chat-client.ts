import type {
  ChatModel,
  ProjectChatEvent,
  ProjectChatRequest
} from "../shared/desktop-api";

type ProjectChatClientOptions = {
  apiBaseUrl: string;
  getAccessToken(): string | undefined;
  onEvent(event: ProjectChatEvent): void;
};

type ModelsResponse = {
  items?: unknown[];
};

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
      const response = await this.request("", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": input.requestId
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
          stream: true
        })
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(readResponseError(payload, response.status));
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const next = parseSseLine(rawLine, content);
          if (!next) continue;
          content = next;
          this.options.onEvent({
            requestId: input.requestId,
            type: "delta",
            content
          });
        }
      }

      if (buffer.trim()) {
        const next = parseSseLine(buffer, content);
        if (next) content = next;
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
  return [
    "You are RouteMarket Work, an AI collaborator operating inside a local desktop project.",
    `Current project: ${input.project.displayName} (${input.project.localProjectId}).`,
    "Use the supplied local file context when relevant.",
    "Do not claim that you changed files, ran commands, or used local tools unless a later tool result explicitly confirms it."
  ].join("\n");
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

function parseSseLine(rawLine: string, currentContent: string) {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trim();
  if (
    !payload ||
    payload === "[DONE]" ||
    payload.startsWith("[DONE_WITH_META]")
  ) {
    return null;
  }

  try {
    const chunk = JSON.parse(payload) as Record<string, unknown>;
    const delta = extractTextDelta(chunk);
    if (delta) return currentContent + delta;
    const fallback = extractTextFallback(chunk);
    if (fallback && !currentContent.includes(fallback)) {
      return currentContent + fallback;
    }
  } catch {
    return null;
  }
  return null;
}

function extractTextDelta(payload: Record<string, unknown>) {
  const eventType = typeof payload.type === "string" ? payload.type : "";
  if (
    eventType === "response.output_text.delta" ||
    eventType === "response.refusal.delta"
  ) {
    return typeof payload.delta === "string" ? payload.delta : "";
  }

  const firstChoice = firstRecord(payload.choices);
  const delta = firstRecord(firstChoice?.delta);
  return typeof delta?.content === "string" ? delta.content : "";
}

function extractTextFallback(payload: Record<string, unknown>) {
  const firstChoice = firstRecord(payload.choices);
  const message = firstRecord(firstChoice?.message);
  if (typeof message?.content === "string") {
    return message.content.trim();
  }

  if (payload.type === "response.completed") {
    const response = firstRecord(payload.response);
    return collectText(response?.output).join("\n\n").trim();
  }
  return "";
}

function collectText(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct =
    typeof record.text === "string"
      ? record.text
      : typeof record.output_text === "string"
        ? record.output_text
        : "";
  return [
    ...(direct.trim() ? [direct.trim()] : []),
    ...collectText(record.content)
  ];
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? candidate as Record<string, unknown>
    : null;
}

function readResponseError(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) return String(message[0] ?? "");
    if (typeof message === "string" && message.trim()) return message;
  }
  return `RouteMarket Work chat request failed (${status}).`;
}
