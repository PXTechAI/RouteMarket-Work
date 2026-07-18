import type { ProjectChatToolCall } from "./project-chat-tools";

type MutableToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ProjectChatStreamResult = {
  text: string;
  toolCalls: ProjectChatToolCall[];
};

export async function readProjectChatStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (text: string) => void
): Promise<ProjectChatStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<string, MutableToolCall>();
  let text = "";
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const nextText = consumeSseLine(line, text, toolCalls);
        if (nextText !== text) {
          text = nextText;
          onText(text);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const nextText = consumeSseLine(buffer, text, toolCalls);
      if (nextText !== text) {
        text = nextText;
        onText(text);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text,
    toolCalls: [...toolCalls.values()].filter((call) => call.name)
  };
}

function consumeSseLine(
  rawLine: string,
  currentText: string,
  toolCalls: Map<string, MutableToolCall>
): string {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return currentText;
  const data = line.slice("data:".length).trim();
  if (!data || data === "[DONE]" || data.startsWith("[DONE_WITH_META]")) {
    return currentText;
  }

  let payload: Record<string, unknown>;
  try {
    const value = JSON.parse(data) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return currentText;
    }
    payload = value as Record<string, unknown>;
  } catch {
    return currentText;
  }

  consumeChatCompletionToolCalls(payload, toolCalls);
  consumeResponsesToolCalls(payload, toolCalls);

  const delta = extractTextDelta(payload);
  if (delta) return currentText + delta;
  const fallback = extractTextFallback(payload);
  if (fallback && !currentText.includes(fallback)) return currentText + fallback;
  return currentText;
}

function consumeChatCompletionToolCalls(
  payload: Record<string, unknown>,
  toolCalls: Map<string, MutableToolCall>
): void {
  const firstChoice = firstRecord(payload.choices);
  const delta = firstRecord(firstChoice?.delta);
  const calls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
  for (const value of calls) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const part = value as Record<string, unknown>;
    const index = typeof part.index === "number" ? part.index : 0;
    const key = `chat:${index}`;
    const current = toolCalls.get(key) ?? { id: "", name: "", arguments: "" };
    const fn = firstRecord(part.function);
    if (typeof part.id === "string" && part.id) current.id = part.id;
    if (typeof fn?.name === "string") current.name += fn.name;
    if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
    toolCalls.set(key, current);
  }

  const message = firstRecord(firstChoice?.message);
  const completeCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (let index = 0; index < completeCalls.length; index += 1) {
    const value = completeCalls[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const call = value as Record<string, unknown>;
    const fn = firstRecord(call.function);
    toolCalls.set(`chat:${index}`, {
      id: typeof call.id === "string" ? call.id : "",
      name: typeof fn?.name === "string" ? fn.name : "",
      arguments: typeof fn?.arguments === "string" ? fn.arguments : ""
    });
  }
}

function consumeResponsesToolCalls(
  payload: Record<string, unknown>,
  toolCalls: Map<string, MutableToolCall>
): void {
  const type = typeof payload.type === "string" ? payload.type : "";
  const item = firstRecord(payload.item);
  if (
    (type === "response.output_item.added" ||
      type === "response.output_item.done") &&
    item?.type === "function_call"
  ) {
    const key = responseToolKey(item, payload);
    const current = toolCalls.get(key) ?? { id: "", name: "", arguments: "" };
    if (typeof item.call_id === "string") current.id = item.call_id;
    if (typeof item.name === "string") current.name = item.name;
    if (typeof item.arguments === "string" && item.arguments) {
      current.arguments = item.arguments;
    }
    toolCalls.set(key, current);
    return;
  }

  if (
    type === "response.function_call_arguments.delta" ||
    type === "response.function_call_arguments.done"
  ) {
    const key = responseToolKey(payload, payload);
    const current = toolCalls.get(key) ?? { id: "", name: "", arguments: "" };
    if (typeof payload.call_id === "string") current.id = payload.call_id;
    if (typeof payload.name === "string") current.name = payload.name;
    if (type.endsWith(".delta") && typeof payload.delta === "string") {
      current.arguments += payload.delta;
    }
    if (type.endsWith(".done") && typeof payload.arguments === "string") {
      current.arguments = payload.arguments;
    }
    toolCalls.set(key, current);
  }
}

function responseToolKey(
  value: Record<string, unknown>,
  fallback: Record<string, unknown>
): string {
  const id =
    (typeof value.id === "string" && value.id) ||
    (typeof value.item_id === "string" && value.item_id) ||
    (typeof fallback.item_id === "string" && fallback.item_id) ||
    (typeof value.call_id === "string" && value.call_id) ||
    (typeof fallback.call_id === "string" && fallback.call_id);
  const index =
    typeof fallback.output_index === "number" ? fallback.output_index : 0;
  return `responses:${id || index}`;
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
  if (typeof message?.content === "string") return message.content.trim();

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
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}
