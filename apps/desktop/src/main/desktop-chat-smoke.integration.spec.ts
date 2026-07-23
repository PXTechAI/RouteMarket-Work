import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeLocalFsRead,
  projectBindingIdFor,
  ProjectRegistry
} from "@routemarket/work-worker-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectChatEvent, ProjectChatRequest } from "../shared/desktop-api";
import { LocalChatStore } from "./local-chat-store";
import { ProjectChatClient } from "./project-chat-client";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";
import { RouteMarketApiClient } from "./routemarket-api-client";
import { LocalToolBroker } from "./tool-broker";

let temporaryDirectory: string | null = null;
let registry: ProjectRegistry | null = null;
let openStores: LocalChatStore[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const store of openStores.splice(0)) store.close();
  registry?.close();
  registry = null;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe("Desktop authenticated chat smoke", () => {
  it("selects an Agent, executes a local Tool, completes, and restores the conversation", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-chat-smoke-"));
    const projectRoot = join(temporaryDirectory, "project");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "answer.ts"), "export const answer = 42;\n", "utf8");

    const databasePath = join(temporaryDirectory, "work.db");
    registry = new ProjectRegistry(databasePath);
    const project = await registry.bindFolder(projectRoot);
    const store = new LocalChatStore(databasePath);
    openStores.push(store);
    const thread = store.getOrCreate(project.localProjectId, project.displayName);
    const workerClient = createWorkerClient(project.localProjectId);
    const toolRunner = new ProjectChatToolRunner({
      workerClient,
      toolBroker: new LocalToolBroker(vi.fn(async () => false))
    });
    const events: ProjectChatEvent[] = [];
    let modelRound = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, _init) => {
      const url = String(input);
      if (url.endsWith("/api/app/v1/agents")) {
        return jsonResponse({ items: [agentPayload] });
      }
      if (url.endsWith("/api/app/v1/agents/agent_smoke")) {
        return jsonResponse(agentPayload);
      }
      if (url.endsWith("/sessions")) {
        return jsonResponse({ session: { id: thread.sessionId } });
      }
      if (url.endsWith("/turns")) {
        return jsonResponse({ session_id: thread.sessionId });
      }
      modelRound += 1;
      if (modelRound === 1) {
        return sseResponse(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_smoke_read","type":"function","function":{"name":"project_read_file","arguments":"{\\"path\\":\\"src/answer.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
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
      appVersion: "0.2.0-smoke"
    });
    apiClient.setAccessToken("rmw_dt_smoke");
    const chatClient = new ProjectChatClient({
      apiClient,
      toolRunner,
      onEvent: (event) => events.push(event)
    });

    const [selectedAgent] = await chatClient.listAgents();
    expect(selectedAgent).toMatchObject({
      id: "agent_smoke",
      revision: 1,
      name: "Smoke Test Agent"
    });

    const sentAt = "2026-07-24T04:00:00.000Z";
    const message = "Read src/answer.ts and report the exported value.";
    store.append({
      id: "user:request_smoke",
      sessionId: thread.sessionId,
      localProjectId: project.localProjectId,
      role: "user",
      content: message,
      sentAt
    });
    const request: ProjectChatRequest = {
      requestId: "request_smoke",
      sessionId: thread.sessionId,
      sentAt,
      model: selectedAgent!.defaultModelCode!,
      message,
      project: {
        localProjectId: project.localProjectId,
        displayName: project.displayName,
        hasFolder: true
      },
      agent: {
        agentId: selectedAgent!.id,
        agentRevision: selectedAgent!.revision,
        executionEnvironment: "local",
        localToolGroups: ["files"],
        maxToolRounds: 3
      }
    };
    await chatClient.send(request);

    const completion = events.at(-1);
    expect(events).toContainEqual(expect.objectContaining({
      requestId: request.requestId,
      type: "tool_completed",
      toolCallId: "call_smoke_read",
      toolName: "project_read_file"
    }));
    expect(completion).toEqual({
      requestId: request.requestId,
      type: "complete",
      content: "The exported value is 42."
    });
    if (!completion || completion.type !== "complete") {
      throw new Error(`Chat smoke did not complete: ${JSON.stringify(completion)}`);
    }
    store.append({
      id: "assistant:request_smoke",
      sessionId: thread.sessionId,
      localProjectId: project.localProjectId,
      role: "assistant",
      content: completion.content,
      sentAt,
      agentId: selectedAgent!.id,
      agentRevision: selectedAgent!.revision,
      agentName: selectedAgent!.name,
      agentAvatarUrl: selectedAgent!.avatarUrl
    });
    store.close();
    openStores = openStores.filter((candidate) => candidate !== store);

    const restoredStore = new LocalChatStore(databasePath);
    openStores.push(restoredStore);
    expect(restoredStore.get(project.localProjectId)).toMatchObject({
      sessionId: thread.sessionId,
      messages: [
        { role: "user", content: message },
        {
          role: "assistant",
          content: "The exported value is 42.",
          agentId: "agent_smoke",
          agentRevision: 1,
          agentName: "Smoke Test Agent"
        }
      ]
    });
    restoredStore.close();
    openStores = openStores.filter((candidate) => candidate !== restoredStore);
    expect(workerClient.readProjectFile).toHaveBeenCalledWith(project.localProjectId, "src/answer.ts");
    expect(fetchMock.mock.calls.every(([, init]) =>
      (init?.headers as Record<string, string> | undefined)?.Authorization === "Bearer rmw_dt_smoke"
    )).toBe(true);
    const modelRequests = fetchMock.mock.calls.filter(([, init]) =>
      new Headers(init?.headers).has("x-request-id")
    );
    expect(modelRequests).toHaveLength(2);
    expect(modelRequests.every(([, init]) =>
      new Headers(init?.headers).get("x-request-id")?.startsWith(request.requestId)
    )).toBe(true);
  });
});

const agentPayload = {
  id: "agent_smoke",
  revision: 1,
  name: "Smoke Test Agent",
  description: "Exercises the desktop chat path.",
  avatar_url: "emoji:🧪|bg:#4162ff",
  system_prompt: "Use the available local file Tool and report the exact exported value.",
  greeting: "Ready to verify the desktop.",
  starter_questions: [],
  tags: ["smoke"],
  default_model_code: "model_chat",
  tools: [],
  execution_policy: {
    environment: "local",
    approval_mode: "risky_only"
  },
  updated_at: "2026-07-24T04:00:00.000Z"
};

function createWorkerClient(localProjectId: string) {
  return {
    listProjectFiles: vi.fn(async () => ({ entries: [], totalEntries: 0, truncated: false })),
    searchProject: vi.fn(async (_projectId: string, query: string) => ({
      query,
      matches: [],
      filesScanned: 0,
      truncated: false
    })),
    readProjectFile: vi.fn(async (projectId: string, relativePath: string) =>
      executeLocalFsRead(registry!, {
        jobId: "djob_chat_smoke",
        workflowRunId: null,
        workflowNodeRunId: null,
        runtimeId: "runtime_chat_smoke",
        projectBindingId: projectBindingIdFor(projectId),
        executorKey: "local.fs.read",
        executorVersion: 1,
        input: {
          uri: `project://${projectId}/${relativePath}`,
          maxBytes: 262_144
        },
        requiredCapabilities: ["local.fs.read"],
        executionClass: "pure_read",
        approvalPolicy: { risk: "R0", mode: "project_grant" },
        idempotencyKey: `sha256:${"a".repeat(64)}`,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        maxInlineResultBytes: 262_144
      })
    ),
    writeProjectFile: vi.fn(async () => { throw new Error("Unexpected write."); }),
    createProjectFile: vi.fn(async () => { throw new Error("Unexpected create."); }),
    startProcess: vi.fn(async () => { throw new Error("Unexpected process start."); }),
    listProcesses: vi.fn(async () => []),
    stopProcess: vi.fn(async () => { throw new Error("Unexpected process stop."); }),
    localProjectId
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(...events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(events.join("")));
      controller.close();
    }
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}
