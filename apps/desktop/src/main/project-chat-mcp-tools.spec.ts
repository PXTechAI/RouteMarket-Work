import { describe, expect, it, vi } from "vitest";
import type { McpServerSummary, McpTool } from "../shared/desktop-api";
import { ProjectChatMcpToolRuntime } from "./project-chat-mcp-tools";
import { LocalToolBroker } from "./tool-broker";

const echoTool: McpTool = {
  name: "echo",
  title: "Echo",
  description: "Echo structured input.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" }
    },
    required: ["text"],
    additionalProperties: false
  }
};

function mcpServer(
  overrides: Partial<McpServerSummary> = {}
): McpServerSummary {
  return {
    serverId: "server_global",
    name: "Global MCP",
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    url: null,
    localProjectId: null,
    enabled: true,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    status: "online",
    tools: [echoTool],
    serverInfo: { name: "test", version: "1.0.0" },
    protocolVersion: "2025-06-18",
    stderr: "",
    lastError: null,
    ...overrides
  };
}

function mcpClient(initialServers: McpServerSummary[]) {
  let servers = initialServers;
  return {
    setServers(next: McpServerSummary[]) {
      servers = next;
    },
    listMcpServers: vi.fn(async () => servers),
    startMcpServer: vi.fn(async (serverId: string) => {
      const server = servers.find((candidate) => candidate.serverId === serverId);
      if (!server) throw new Error("Missing MCP server.");
      const started = { ...server, status: "online" as const };
      servers = servers.map((candidate) =>
        candidate.serverId === serverId ? started : candidate
      );
      return started;
    }),
    callMcpTool: vi.fn(async (
      _serverId: string,
      _name: string,
      args: Record<string, unknown>
    ): Promise<Record<string, unknown>> => ({ args }))
  };
}

function runtime(
  client: ReturnType<typeof mcpClient>,
  confirm: (request: Parameters<ConstructorParameters<typeof LocalToolBroker>[0]>[0]) =>
    Promise<boolean> = async () => true
) {
  return new ProjectChatMcpToolRuntime({
    client,
    toolBroker: new LocalToolBroker(confirm)
  });
}

describe("ProjectChatMcpToolRuntime", () => {
  it("generates unique project-scoped function definitions with safe schemas", async () => {
    const oversizedSchema = {
      type: "object",
      description: "x".repeat(130 * 1024)
    };
    const client = mcpClient([
      mcpServer({
        serverId: "全局 server",
        tools: [echoTool, echoTool]
      }),
      mcpServer({
        serverId: "project/server",
        name: "Project MCP",
        localProjectId: "project_1",
        status: "offline",
        tools: [{
          name: "invalid tool name !",
          inputSchema: oversizedSchema
        }]
      }),
      mcpServer({
        serverId: "disabled",
        enabled: false
      }),
      mcpServer({
        serverId: "other_project",
        localProjectId: "project_2"
      })
    ]);

    const definitions = await runtime(client).listDefinitions("project_1");

    expect(definitions).toHaveLength(2);
    expect(new Set(definitions.map((item) => item.function.name)).size).toBe(2);
    for (const definition of definitions) {
      expect(definition.function.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(definition.function.name).toMatch(/^mcp_local_/);
    }
    expect(
      definitions.find((item) => item.function.description.includes("Project MCP"))
        ?.function.parameters
    ).toEqual({
      type: "object",
      properties: {},
      additionalProperties: true
    });
    expect(
      definitions.find((item) => item.function.description.includes("Global MCP"))
        ?.function.parameters
    ).toEqual(echoTool.inputSchema);
  });

  it("approves before starting and invoking an offline server", async () => {
    const client = mcpClient([
      mcpServer({ status: "offline", localProjectId: "project_1" })
    ]);
    const confirm = vi.fn(async () => {
      expect(client.startMcpServer).not.toHaveBeenCalled();
      expect(client.callMcpTool).not.toHaveBeenCalled();
      return true;
    });
    const subject = runtime(client, confirm);
    const [definition] = await subject.listDefinitions("project_1");

    const result = await subject.execute("project_1", {
      id: "call_1",
      name: definition.function.name,
      arguments: JSON.stringify({ text: "hello" })
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.mcp.call",
      risk: "R2",
      projectId: "project_1"
    }));
    expect(client.startMcpServer).toHaveBeenCalledWith("server_global");
    expect(client.callMcpTool).toHaveBeenCalledWith(
      "server_global",
      "echo",
      { text: "hello" }
    );
    expect(result).toEqual({
      content: JSON.stringify({ args: { text: "hello" } }),
      summary: "Global MCP · Echo",
      isError: false
    });
  });

  it("does not restart an online server", async () => {
    const client = mcpClient([mcpServer()]);
    const subject = runtime(client);
    const [definition] = await subject.listDefinitions("project_1");

    await subject.execute("project_1", {
      id: "call_1",
      name: definition.function.name,
      arguments: "{}"
    });

    expect(client.startMcpServer).not.toHaveBeenCalled();
    expect(client.callMcpTool).toHaveBeenCalledOnce();
  });

  it("does not start or invoke a server when approval is denied", async () => {
    const client = mcpClient([mcpServer({ status: "offline" })]);
    const subject = runtime(client, async () => false);
    const [definition] = await subject.listDefinitions("project_1");

    const result = await subject.execute("project_1", {
      id: "call_1",
      name: definition.function.name,
      arguments: "{}"
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "TOOL_APPROVAL_DENIED" }
    });
    expect(client.startMcpServer).not.toHaveBeenCalled();
    expect(client.callMcpTool).not.toHaveBeenCalled();
  });

  it("revalidates project scope after approval", async () => {
    const original = mcpServer({ localProjectId: "project_1", status: "offline" });
    const moved = { ...original, localProjectId: "project_2" };
    const client = mcpClient([original]);
    const subject = runtime(client, async () => {
      client.setServers([moved]);
      return true;
    });
    const [definition] = await subject.listDefinitions("project_1");

    const result = await subject.execute("project_1", {
      id: "call_1",
      name: definition.function.name,
      arguments: "{}"
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "MCP_PROJECT_SCOPE_INVALID" }
    });
    expect(client.startMcpServer).not.toHaveBeenCalled();
    expect(client.callMcpTool).not.toHaveBeenCalled();
  });

  it("rejects a dynamic tool that disappeared before invocation", async () => {
    const client = mcpClient([mcpServer()]);
    const subject = runtime(client);
    const [definition] = await subject.listDefinitions("project_1");
    client.setServers([]);

    const result = await subject.execute("project_1", {
      id: "call_1",
      name: definition.function.name,
      arguments: "{}"
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "MCP_TOOL_NOT_AVAILABLE" }
    });
  });

  it("returns oversized and structured Worker results as valid Tool JSON", async () => {
    const client = mcpClient([mcpServer()]);
    client.callMcpTool.mockResolvedValueOnce({ text: "x".repeat(170_000) });
    const subject = runtime(client);
    const [definition] = await subject.listDefinitions("project_1");

    const result = await subject.execute("project_1", {
      id: "call_1",
      name: definition.function.name,
      arguments: "{}"
    });
    const content = JSON.parse(result.content);

    expect(result.isError).toBe(false);
    expect(content).toMatchObject({
      truncated: true
    });
    expect(content.original_characters).toBeGreaterThan(160_000);
    expect(content.result_preview.length).toBe(160_000);
  });

  it("preserves Worker error codes and aborts before calling MCP", async () => {
    const client = mcpClient([mcpServer()]);
    const subject = runtime(client);
    const [definition] = await subject.listDefinitions("project_1");
    client.callMcpTool.mockRejectedValueOnce(
      Object.assign(new Error("MCP request failed."), { code: "MCP_CALL_FAILED" })
    );

    const failed = await subject.execute("project_1", {
      id: "call_1",
      name: definition.function.name,
      arguments: "{}"
    });
    expect(JSON.parse(failed.content)).toEqual({
      error: {
        code: "MCP_CALL_FAILED",
        message: "MCP request failed."
      }
    });

    const controller = new AbortController();
    controller.abort();
    await expect(subject.execute("project_1", {
      id: "call_2",
      name: definition.function.name,
      arguments: "{}"
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(client.callMcpTool).toHaveBeenCalledTimes(1);
  });
});
