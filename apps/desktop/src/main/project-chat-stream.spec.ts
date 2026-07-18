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
      toolCalls: [{
        id: "call_1",
        name: "project_search",
        arguments: '{"query":"RouteMarket"}'
      }]
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
});
