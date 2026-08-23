import { describe, expect, it } from "vitest";
import { readProjectChatStream } from "./project-chat-stream";

function stream(...events: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(events.join("")));
      controller.close();
    }
  });
}

describe("readProjectChatStream", () => {
  it("collects Responses API function call arguments", async () => {
    const result = await readProjectChatStream(
      stream(
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"project_search","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"query\\":"}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"\\"RouteMarket\\"}"}\n\n',
        'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":0,"arguments":"{\\"query\\":\\"RouteMarket\\"}"}\n\n',
        "data: [DONE]\n\n"
      ),
      new AbortController().signal,
      () => undefined
    );

    expect(result).toEqual({
      text: "",
      reasoning: "",
      toolCalls: [{
        id: "call_1",
        name: "project_search",
        arguments: '{"query":"RouteMarket"}'
      }],
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cachedInputTokens: null,
        cacheCreationInputTokens: null
      }
    });
  });

  it("streams text while preserving a complete fallback message", async () => {
    const snapshots: string[] = [];
    const result = await readProjectChatStream(
      stream(
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n"
      ),
      new AbortController().signal,
      (text) => snapshots.push(text)
    );

    expect(result.text).toBe("Hello world");
    expect(snapshots).toContain("Hello world");
  });

  it("streams Responses API reasoning summaries separately from answer text", async () => {
    const reasoningSnapshots: string[] = [];
    const result = await readProjectChatStream(
      stream(
        'data: {"type":"response.reasoning_summary_part.added","summary_index":0,"part":{"type":"summary_text","text":""}}\n\n',
        'data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":"Inspecting the project"}\n\n',
        'data: {"type":"response.reasoning_summary_text.delta","summary_index":0,"delta":" structure."}\n\n',
        'data: {"type":"response.output_text.delta","delta":"Done."}\n\n',
        "data: [DONE]\n\n"
      ),
      new AbortController().signal,
      () => undefined,
      (reasoning) => reasoningSnapshots.push(reasoning)
    );

    expect(result).toMatchObject({
      text: "Done.",
      reasoning: "Inspecting the project structure."
    });
    expect(reasoningSnapshots).toEqual([
      "Inspecting the project",
      "Inspecting the project structure."
    ]);
  });

  it("collects final token and cache usage from streamed model events", async () => {
    const result = await readProjectChatStream(
      stream(
        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":90}}}\n\n',
        "data: [DONE]\n\n"
      ),
      new AbortController().signal,
      () => undefined
    );
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 90,
      cacheCreationInputTokens: null
    });
  });
});
