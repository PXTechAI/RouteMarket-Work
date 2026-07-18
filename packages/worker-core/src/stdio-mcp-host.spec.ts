import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpRegistry } from "./mcp-registry";
import { ProjectRegistry } from "./project-registry";
import { StdioMcpHost } from "./stdio-mcp-host";

const SERVER_SCRIPT = `
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture-mcp", version: "1.0.0" }
    }});
  } else if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{
      name: "echo", description: "Echo arguments", inputSchema: { type: "object" }
    }] }});
  } else if (message.method === "tools/call") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      content: [{ type: "text", text: JSON.stringify(message.params.arguments) }],
      isError: false
    }});
  }
});
`;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-mcp-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  const databasePath = join(root, "work.db");
  const projects = new ProjectRegistry(databasePath);
  const registry = new McpRegistry(databasePath);
  const project = await projects.bindFolder(projectRoot);
  const host = new StdioMcpHost(registry, projects, root);
  cleanups.push(async () => {
    await host.stopAll();
    registry.close();
    projects.close();
  });
  return { databasePath, root, project, projects, registry, host };
}

describe("StdioMcpHost", () => {
  it("initializes a server, discovers tools and invokes a tool", async () => {
    const value = await fixture();
    const config = value.registry.install({
      name: "Fixture MCP",
      command: process.execPath,
      args: ["-e", SERVER_SCRIPT],
      localProjectId: value.project.localProjectId
    });
    const online = await value.host.start(config.serverId);
    expect(online).toMatchObject({
      status: "online",
      protocolVersion: "2025-11-25",
      serverInfo: { name: "fixture-mcp", version: "1.0.0" },
      tools: [{ name: "echo" }]
    });
    await expect(value.host.callTool(config.serverId, "echo", { message: "hello" }))
      .resolves.toMatchObject({
        content: [{ type: "text", text: '{"message":"hello"}' }],
        isError: false
      });
    await expect(value.host.stop(config.serverId)).resolves.toMatchObject({ status: "offline" });
  });

  it("persists server configuration without secret environment fields", async () => {
    const value = await fixture();
    const config = value.registry.install({
      name: "Persistent MCP",
      command: process.execPath,
      args: ["-e", SERVER_SCRIPT]
    });
    expect(value.registry.list()).toContainEqual(config);
    value.registry.setEnabled(config.serverId, false);
    await expect(value.host.start(config.serverId)).rejects.toMatchObject({
      code: "MCP_SERVER_DISABLED"
    });
  });

  it("rejects calls to tools not returned by discovery", async () => {
    const value = await fixture();
    const config = value.registry.install({
      name: "Fixture MCP",
      command: process.execPath,
      args: ["-e", SERVER_SCRIPT]
    });
    await value.host.start(config.serverId);
    await expect(value.host.callTool(config.serverId, "missing", {})).rejects.toMatchObject({
      code: "MCP_TOOL_NOT_FOUND"
    });
  });

  it("rejects and terminates a server that writes non-JSON protocol data to stdout", async () => {
    const value = await fixture();
    const config = value.registry.install({
      name: "Invalid MCP",
      command: process.execPath,
      args: ["-e", 'process.stdout.write("not-json\\n"); setInterval(() => {}, 1_000);']
    });
    await expect(value.host.start(config.serverId)).rejects.toMatchObject({
      code: "MCP_PROTOCOL_ERROR"
    });
    expect(value.host.list().find((server) => server.serverId === config.serverId)).toMatchObject({
      status: "error",
      lastError: "MCP server wrote non-JSON data to stdout."
    });
  });

  it("initializes and invokes a Streamable HTTP MCP server with session continuity", async () => {
    const receivedSessionIds: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk.toString(); });
      request.on("end", () => {
        const message = JSON.parse(body || "{}") as { id?: number; method?: string; params?: unknown };
        receivedSessionIds.push(request.headers["mcp-session-id"] as string | undefined);
        if (message.method === "initialize") {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Mcp-Session-Id", "session-fixture-1");
          response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "http-fixture", version: "1.0.0" }
          }}));
        } else if (message.method === "notifications/initialized") {
          response.statusCode = 202;
          response.end();
        } else if (message.method === "tools/list") {
          response.setHeader("Content-Type", "text/event-stream");
          response.end(`event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          })}\n\n`);
        } else if (message.method === "tools/call") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: JSON.stringify(message.params) }] }
          }));
        } else {
          response.statusCode = 404;
          response.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    ));
    const address = server.address() as AddressInfo;
    const value = await fixture();
    const config = value.registry.install({
      name: "HTTP MCP",
      transport: "streamable-http",
      url: `http://127.0.0.1:${address.port}/mcp`
    });

    await expect(value.host.start(config.serverId)).resolves.toMatchObject({
      transport: "streamable-http",
      status: "online",
      serverInfo: { name: "http-fixture" },
      tools: [{ name: "echo" }]
    });
    await expect(value.host.callTool(config.serverId, "echo", { value: 42 })).resolves.toMatchObject({
      content: [{ type: "text" }]
    });
    expect(receivedSessionIds).toEqual([
      undefined,
      "session-fixture-1",
      "session-fixture-1",
      "session-fixture-1"
    ]);
  });
});
