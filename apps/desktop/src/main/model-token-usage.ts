import type { LocalApiGatewayUsage } from "../shared/desktop-api";

export type ModelTokenUsage = Pick<
  LocalApiGatewayUsage,
  "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens" | "cacheCreationInputTokens"
>;

export function emptyModelTokenUsage(): ModelTokenUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null
  };
}

export function extractModelTokenUsage(value: unknown): ModelTokenUsage | null {
  const root = asRecord(value);
  if (!root) return null;
  const usage = firstRecord(
    root.usage,
    asRecord(root.response)?.usage,
    asRecord(root.message)?.usage
  );
  if (!usage) return null;

  const inputDetails = firstRecord(usage.input_tokens_details, usage.prompt_tokens_details);
  const inputTokens = firstNumber(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = firstNumber(usage.output_tokens, usage.completion_tokens);
  const explicitTotal = firstNumber(usage.total_tokens);
  const cachedInputTokens = firstNumber(
    usage.cache_read_input_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cached_input_tokens,
    inputDetails?.cached_tokens
  );
  const anthropicCacheUsage = typeof usage.cache_read_input_tokens === "number" || typeof usage.cache_creation_input_tokens === "number";
  const cacheCreationInputTokens = firstNumber(usage.cache_creation_input_tokens) ?? (anthropicCacheUsage ? 0 : null);
  if (
    inputTokens === null && outputTokens === null && explicitTotal === null &&
    cachedInputTokens === null && cacheCreationInputTokens === null
  ) return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens: explicitTotal ?? derivedTotal(inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens),
    cachedInputTokens,
    cacheCreationInputTokens
  };
}

export function mergeModelTokenUsage(
  current: ModelTokenUsage,
  next: ModelTokenUsage | null
): ModelTokenUsage {
  if (!next) return current;
  const inputTokens = next.inputTokens ?? current.inputTokens ?? null;
  const outputTokens = next.outputTokens ?? current.outputTokens ?? null;
  const cachedInputTokens = next.cachedInputTokens ?? current.cachedInputTokens ?? null;
  const cacheCreationInputTokens = next.cacheCreationInputTokens ?? current.cacheCreationInputTokens ?? null;
  return {
    inputTokens,
    outputTokens,
    totalTokens: next.totalTokens ?? current.totalTokens ?? derivedTotal(inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens),
    cachedInputTokens,
    cacheCreationInputTokens
  };
}

export function sumModelTokenUsage(
  current: ModelTokenUsage,
  next: ModelTokenUsage | null
): ModelTokenUsage {
  if (!next) return current;
  return {
    inputTokens: sumNullable(current.inputTokens ?? null, next.inputTokens ?? null),
    outputTokens: sumNullable(current.outputTokens ?? null, next.outputTokens ?? null),
    totalTokens: sumNullable(current.totalTokens ?? null, next.totalTokens ?? null),
    cachedInputTokens: sumNullable(current.cachedInputTokens ?? null, next.cachedInputTokens ?? null),
    cacheCreationInputTokens: sumNullable(
      current.cacheCreationInputTokens ?? null,
      next.cacheCreationInputTokens ?? null
    )
  };
}

export function observeResponseTokenUsage(
  response: Response,
  onComplete: (usage: ModelTokenUsage) => void | Promise<void>
): Response {
  if (!response.body) {
    void onComplete(emptyModelTokenUsage());
    return response;
  }
  const decoder = new TextDecoder();
  const isEventStream = response.headers.get("content-type")?.includes("text/event-stream") === true;
  let buffer = "";
  let usage = emptyModelTokenUsage();
  const consumeEventLines = (text: string, flush = false) => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = flush ? "" : lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      usage = mergeModelTokenUsage(usage, extractModelTokenUsage(parseJson(data)));
    }
  };
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (isEventStream) consumeEventLines(decoder.decode(chunk, { stream: true }));
      else buffer += decoder.decode(chunk, { stream: true });
      controller.enqueue(chunk);
    },
    async flush() {
      const tail = decoder.decode();
      if (isEventStream) consumeEventLines(tail, true);
      else usage = mergeModelTokenUsage(usage, extractModelTokenUsage(parseJson(buffer + tail)));
      await onComplete(usage);
    }
  });
  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  return null;
}

function derivedTotal(
  inputTokens: number | null,
  outputTokens: number | null,
  cachedInputTokens: number | null,
  cacheCreationInputTokens: number | null
): number | null {
  if (inputTokens === null || outputTokens === null) return null;
  return cacheCreationInputTokens !== null
    ? inputTokens + outputTokens + (cachedInputTokens ?? 0) + cacheCreationInputTokens
    : inputTokens + outputTokens;
}

function sumNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
