import type { ProjectChatToolCall } from "./project-chat-tools";

type MutableToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ProjectChatStreamResult = {
  text: string;
  reasoning: string;
  toolCalls: ProjectChatToolCall[];
};

export async function readProjectChatStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (text: string) => void,
  onReasoning: (reasoning: string) => void = () => undefined
): Promise<ProjectChatStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<string, MutableToolCall>();
  let text = "";
  let reasoning = "";
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
        const next = consumeSseLine(line, text, reasoning, toolCalls);
        if (next.text !== text) {
          text = next.text;
          onText(text);
        }
        if (next.reasoning !== reasoning) {
          reasoning = next.reasoning;
          onReasoning(reasoning);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const next = consumeSseLine(buffer, text, reasoning, toolCalls);
      if (next.text !== text) {
        text = next.text;
        onText(text);
      }
      if (next.reasoning !== reasoning) {
        reasoning = next.reasoning;
        onReasoning(reasoning);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text,
    reasoning,
    toolCalls: [...toolCalls.values()].filter((call) => call.name)
  };
}

function consumeSseLine(
  rawLine: string,
  currentText: string,
  currentReasoning: string,
  toolCalls: Map<string, MutableToolCall>
): { text: string; reasoning: string } {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) {
    return { text: currentText, reasoning: currentReasoning };
  }
  const data = line.slice("data:".length).trim();
  if (!data || data === "[DONE]" || data.startsWith("[DONE_WITH_META]")) {
    return { text: currentText, reasoning: currentReasoning };
  }

  let payload: Record<string, unknown>;
  try {
    const value = JSON.parse(data) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { text: currentText, reasoning: currentReasoning };
    }
    payload = value as Record<string, unknown>;
  } catch {
    return { text: currentText, reasoning: currentReasoning };
  }

  consumeChatCompletionToolCalls(payload, toolCalls);
  consumeResponsesToolCalls(payload, toolCalls);

  let text = currentText;
  let reasoning = currentReasoning;

  const delta = extractTextDelta(payload);
  if (delta) text += delta;
  const fallback = extractTextFallback(payload);
  if (fallback && !text.includes(fallback)) text += fallback;

  const reasoningDelta = extractReasoningDelta(payload);
  if (reasoningDelta) reasoning += reasoningDelta;
  if (
    payload.type === "response.reasoning_summary_part.added" &&
    reasoning.trim()
  ) {
    reasoning += "\n\n";
  }
  const reasoningFallback = extractReasoningFallback(payload);
  if (reasoningFallback) reasoning = mergeFallback(reasoning, reasoningFallback);

  return { text, reasoning };
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

function extractReasoningDelta(payload: Record<string, unknown>): string {
  const eventType = typeof payload.type === "string" ? payload.type : "";
  if (eventType === "response.reasoning_summary_text.delta") {
    return typeof payload.delta === "string" ? payload.delta : "";
  }
  return "";
}

function mergeFallback(current: string, fallback: string): string {
  if (!current) return fallback;
  if (fallback.startsWith(current)) return fallback;
  if (current.includes(fallback)) return current;
  return current + fallback;
}

function extractReasoningFallback(payload: Record<string, unknown>): string {
  if (
    payload.type === "response.reasoning_summary_text.done" &&
    typeof payload.text === "string"
  ) {
    return payload.text.trim();
  }
  if (payload.type !== "response.completed") return "";
  const response = firstRecord(payload.response);
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      return record.type === "reasoning" ? collectText(record.summary) : [];
    })
    .join("\n\n")
    .trim();
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
