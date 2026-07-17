import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectChatEvent,
  ProjectChatRequest
} from "../shared/desktop-api";
import { ProjectChatClient } from "./project-chat-client";

const request: ProjectChatRequest = {
  requestId: "request_1",
  sessionId: "session_1",
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

function createClient(events: ProjectChatEvent[] = []) {
  return new ProjectChatClient({
    apiBaseUrl: "https://api.example.test",
    getAccessToken: () => "rmw_dt_test",
    onEvent: (event) => events.push(event)
  });
}

describe("ProjectChatClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        category: "chat",
        supportsTools: true,
        supportsVision: false,
        supportsStream: true
      },
      {
        code: "model_reasoning",
        displayName: "Reasoning Model",
        category: "reasoning",
        supportsTools: false,
        supportsVision: false,
        supportsStream: false
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

  it("streams OpenAI chat completion deltas and completes with accumulated text", async () => {
    const events: ProjectChatEvent[] = [];
    const fetchMock = vi.fn<typeof fetch>(async () =>
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
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      session_id: "session_1",
      request_id: "request_1",
      model: "model_chat",
      stream: true
    });
    expect(body.message.content).toContain("src/index.ts");
    expect(body.message.content).toContain("export const answer = 42;");
  });

  it("streams Responses API output text deltas", async () => {
    const events: ProjectChatEvent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
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

  it("emits a stopped event when an active request is cancelled", async () => {
    const events: ProjectChatEvent[] = [];
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient(events);

    const pending = client.send(request);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
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
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ message: "Model is unavailable." }, 503)
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
