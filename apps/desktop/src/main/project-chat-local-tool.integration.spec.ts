import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeLocalFsRead,
  projectBindingIdFor,
  ProjectRegistry
} from "@routemarket/work-worker-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectChatEvent,
  ProjectChatRequest
} from "../shared/desktop-api";
import { LocalToolBroker } from "./tool-broker";
import { ProjectChatClient } from "./project-chat-client";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";
import { RouteMarketApiClient } from "./routemarket-api-client";

let registry: ProjectRegistry | null = null;
let tempRoot: string | null = null;

afterEach(async () => {
  vi.unstubAllGlobals();
  registry?.close();
  registry = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("Project chat local Tool integration", () => {
  it("reads a bound project file and returns the Tool result to the next model round", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "routemarket-chat-tool-"));
    const projectRoot = join(tempRoot, "project");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "answer.ts"),
      "export const answer = 42;\n",
      "utf8"
    );

    registry = new ProjectRegistry(join(tempRoot, "work.db"));
    const project = await registry.bindFolder(projectRoot);
    const workerClient = {
      listProjectFiles: vi.fn(async () => ({
        entries: [],
        totalEntries: 0,
        truncated: false
      })),
      searchProject: vi.fn(async (_localProjectId: string, query: string) => ({
        query,
        matches: [],
        filesScanned: 0,
        truncated: false
      })),
      readProjectFile: vi.fn(async (
        localProjectId: string,
        relativePath: string
      ) => executeLocalFsRead(registry!, {
        jobId: "djob_project_chat_read",
        workflowRunId: null,
        workflowNodeRunId: null,
        runtimeId: "runtime_project_chat",
        projectBindingId: projectBindingIdFor(localProjectId),
        executorKey: "local.fs.read",
        executorVersion: 1,
        input: {
          uri: `project://${localProjectId}/${relativePath}`,
          maxBytes: 262_144
        },
        requiredCapabilities: ["local.fs.read"],
        executionClass: "pure_read",
        approvalPolicy: {
          risk: "R0",
          mode: "project_grant"
        },
        idempotencyKey: `sha256:${"a".repeat(64)}`,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        maxInlineResultBytes: 262_144
      })),
      writeProjectFile: vi.fn(async () => {
        throw new Error("Unexpected write.");
      }),
      createProjectFile: vi.fn(async () => {
        throw new Error("Unexpected create.");
      }),
      startProcess: vi.fn(async () => {
        throw new Error("Unexpected process start.");
      }),
      listProcesses: vi.fn(async () => []),
      stopProcess: vi.fn(async () => {
        throw new Error("Unexpected process stop.");
      })
    };
    const toolRunner = new ProjectChatToolRunner({
      workerClient,
      toolBroker: new LocalToolBroker(vi.fn(async () => false))
    });
    const events: ProjectChatEvent[] = [];
    const request: ProjectChatRequest = {
      requestId: "request_local_tool",
      sessionId: "session_local_tool",
      sentAt: "2026-07-19T00:00:00.000Z",
      model: "model_chat",
      message: "Read src/answer.ts and report the exported value.",
      project: {
        localProjectId: project.localProjectId,
        displayName: project.displayName
      },
      projectContext: {
        instructions: null,
        readme: null,
        settings: {
          defaultAgent: null,
          defaultModel: null,
          cloudProjectId: null,
          ignore: []
        },
        skills: []
      }
    };

    let modelRound = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: request.sessionId } });
      }
      if (url.endsWith("/turns")) {
        return jsonResponse({ session_id: request.sessionId });
      }
      modelRound += 1;
      if (modelRound === 1) {
        return sseResponse(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read_answer","type":"function","function":{"name":"project_read_file","arguments":"{\\"path\\":\\"src/answer.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n"
        );
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"The exported value is 42."}}]}\n\n',
        "data: [DONE]\n\n"
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const apiClient = new RouteMarketApiClient({
      baseUrl: "https://api.example.test",
      appVersion: "0.1.0"
    });
    apiClient.setAccessToken("rmw_dt_test");
    await new ProjectChatClient({
      apiClient,
      onEvent: (event) => events.push(event),
      toolRunner
    }).send(request);

    expect(workerClient.readProjectFile).toHaveBeenCalledWith(
      project.localProjectId,
      "src/answer.ts"
    );
    const secondRound = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRound.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_read_answer",
          type: "function",
          function: {
            name: "project_read_file",
            arguments: '{"path":"src/answer.ts"}'
          }
        }]
      },
      {
        role: "tool",
        tool_call_id: "call_read_answer",
        content: expect.stringContaining("export const answer = 42;")
      }
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      requestId: request.requestId,
      type: "tool_completed",
      toolCallId: "call_read_answer",
      toolName: "project_read_file"
    }));
    expect(events.at(-1)).toMatchObject({
      requestId: request.requestId,
      type: "complete",
      content: "The exported value is 42."
    });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
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
