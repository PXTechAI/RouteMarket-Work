import { describe, expect, it, vi } from "vitest";
import type { DesktopWorkflowDraftNode } from "../shared/desktop-api";
import { CloudWorkflowClient } from "./cloud-workflow-client";

describe("CloudWorkflowClient", () => {
  it("submits one cloud node, polls it, and returns its native text output", async () => {
    const fetchImpl = mockFetch([
      jsonResponse({ task_id: "task_1" }),
      jsonResponse({ id: "task_1", status: "processing" }),
      jsonResponse({
        id: "task_1",
        status: "succeeded",
        output: {
          report: {
            finalOutputs: [{
              id: "output_1",
              type: "text",
              text: "Cloud result",
              preview: "Cloud result",
              sourceNodeId: "node_cloud",
              sourceNodeTitle: "Cloud LLM",
              sourcePortId: "text"
            }]
          }
        }
      })
    ]);
    const client = createClient(fetchImpl);

    const result = await client.executeNode(
      cloudNode(),
      { prompt: "Hello", $localProjectId: "project_test" },
      new AbortController().signal
    );

    expect(result).toBe("Cloud result");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://core.test/api/app/v1/workflows/execute");
    expect(init?.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer rmw_dt_test",
      "Content-Type": "application/json",
      "X-Request-ID": expect.stringMatching(/^work_workflow_/)
    }));
    const body = JSON.parse(String(init?.body));
    expect(body.request_id).toBe(init?.headers && (init.headers as Record<string, string>)["X-Request-ID"]);
    expect(body.nodes[0]).toEqual({
      id: "node_cloud",
      data: {
        title: "Cloud LLM",
        nodeType: "llm.prompt",
        kind: "llm",
        executionMode: "transform",
        joinStrategy: "passthrough",
        config: { prompt: "Hello" },
        runtime: {
          executorKey: "cloud.llm.prompt",
          executionTarget: "cloud"
        },
        inputPorts: [{ id: "prompt", accepts: ["text"], required: false }],
        outputPorts: [{ id: "text", produces: ["text"], required: false }]
      }
    });
  });

  it("cancels the Core task once when the local Workflow signal is aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "task_cancel" }))
      .mockImplementationOnce(async () => {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      })
      .mockResolvedValueOnce(jsonResponse({ id: "task_cancel", status: "cancelled" }));
    const client = createClient(fetchImpl);

    await expect(
      client.executeNode(cloudNode(), { prompt: "Stop" }, controller.signal)
    ).rejects.toMatchObject({
      name: "AbortError",
      code: "WORKFLOW_CANCELED"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      "http://core.test/api/app/v1/workflows/executions/task_cancel/cancel"
    );
  });

  it("surfaces cloud task errors and authentication failures", async () => {
    const failedClient = createClient(mockFetch([
      jsonResponse({ id: "task_failed" }),
      jsonResponse({
        id: "task_failed",
        status: "failed",
        error: { code: "PROVIDER_ERROR", message: "Provider refused the request." }
      })
    ]));
    await expect(
      failedClient.executeNode(
        cloudNode(),
        { prompt: "Fail" },
        new AbortController().signal
      )
    ).rejects.toThrow("Provider refused the request.");

    const authClient = createClient(mockFetch([
      jsonResponse({ message: "Expired" }, 401)
    ]));
    await expect(
      authClient.executeNode(
        cloudNode(),
        { prompt: "Hello" },
        new AbortController().signal
      )
    ).rejects.toThrow("sign in again");
  });

  it("requires sign-in and canonical cloud runtime metadata", async () => {
    const signedOut = new CloudWorkflowClient({
      apiBaseUrl: "http://core.test",
      getAccessToken: () => undefined,
      fetchImpl: vi.fn()
    });
    await expect(
      signedOut.executeNode(
        cloudNode(),
        {},
        new AbortController().signal
      )
    ).rejects.toThrow("Sign in");

    const missingRuntime = cloudNode();
    delete missingRuntime.definitionSnapshot.cloudRuntime;
    await expect(
      createClient(vi.fn()).executeNode(
        missingRuntime,
        {},
        new AbortController().signal
      )
    ).rejects.toThrow("missing its RouteMarket runtime definition");
  });
});

function createClient(fetchImpl: typeof fetch) {
  return new CloudWorkflowClient({
    apiBaseUrl: "http://core.test",
    getAccessToken: () => "rmw_dt_test",
    pollIntervalMs: 0,
    fetchImpl
  });
}

function mockFetch(responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  return mock;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function cloudNode(): DesktopWorkflowDraftNode {
  return {
    nodeId: "node_cloud",
    executorKey: "cloud.llm.prompt",
    title: "Cloud LLM",
    executionTarget: "cloud",
    x: 0,
    y: 0,
    config: {},
    definitionSnapshot: {
      executorKey: "cloud.llm.prompt",
      definitionVersion: 1,
      source: "cloud",
      executionTarget: "cloud",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: [],
      portability: "portable",
      definitionHash: `sha256:${"c".repeat(64)}`,
      title: "Cloud LLM",
      description: "Run an LLM prompt in RouteMarket.",
      available: true,
      blockedReason: null,
      cloudRuntime: {
        nodeType: "llm.prompt",
        kind: "llm",
        executionMode: "transform",
        joinStrategy: "passthrough",
        inputPorts: [{ id: "prompt", accepts: ["text"], required: false }],
        outputPorts: [{ id: "text", produces: ["text"], required: false }]
      }
    }
  };
}
