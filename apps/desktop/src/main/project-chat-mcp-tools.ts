import { trMain } from "./i18n";
import { createHash } from "node:crypto";
import type { McpServerSummary, McpTool } from "../shared/desktop-api";
import type { LocalToolBroker } from "./tool-broker";
import type { WorkerClient } from "./worker-client";
import type {
  ProjectChatToolCall,
  ProjectChatToolDefinition,
  ProjectChatToolExecution
} from "./project-chat-tools";
import type { ToolApprovalMode } from "./tool-broker";

const MCP_TOOL_PREFIX = "mcp_local_";
const MAX_DYNAMIC_MCP_TOOLS = 128;
const MAX_SCHEMA_BYTES = 128 * 1024;
const MAX_TOOL_RESULT_CHARACTERS = 160_000;
const MAX_DESCRIPTION_CHARACTERS = 1_000;
const MAX_FUNCTION_NAME_LENGTH = 64;

type ProjectChatMcpClient = Pick<
  WorkerClient,
  "listMcpServers" | "startMcpServer" | "callMcpTool"
>;

type ProjectChatMcpToolRuntimeOptions = {
  client: ProjectChatMcpClient;
  toolBroker: LocalToolBroker;
  onActivity?: (
    type: "job.started" | "job.succeeded" | "job.failed",
    title: string,
    detail: string
  ) => void;
};

type ResolvedMcpTool = {
  server: McpServerSummary;
  tool: McpTool;
};

export class ProjectChatMcpToolRuntime {
  constructor(private readonly options: ProjectChatMcpToolRuntimeOptions) {}

  isDynamicToolName(name: string): boolean {
    return name.startsWith(MCP_TOOL_PREFIX);
  }

  async listDefinitions(localProjectId: string): Promise<ProjectChatToolDefinition[]> {
    const servers = await this.options.client.listMcpServers();
    const definitions = eligibleServers(servers, localProjectId)
      .flatMap((server) =>
        server.tools.map((tool) => ({
          server,
          tool,
          definition: toToolDefinition(server, tool)
        }))
      )
      .sort((left, right) =>
        left.definition.function.name.localeCompare(right.definition.function.name)
      );
    const unique = new Map<string, ProjectChatToolDefinition>();
    for (const { definition } of definitions) {
      if (!unique.has(definition.function.name)) {
        unique.set(definition.function.name, definition);
      }
      if (unique.size >= MAX_DYNAMIC_MCP_TOOLS) break;
    }
    return [...unique.values()];
  }

  async execute(
    localProjectId: string,
    call: ProjectChatToolCall,
    signal?: AbortSignal,
    approvalMode: ToolApprovalMode = "risky_only"
  ): Promise<ProjectChatToolExecution> {
    try {
      throwIfAborted(signal);
      const args = parseArguments(call.arguments);
      const resolved = await this.resolve(localProjectId, call.name);
      const title = resolved.tool.title ?? resolved.tool.name;
      const detail = `${resolved.server.name} · ${title}`;
      return await this.runWithActivity(trMain("ui.eaed5d1baccf", [title]), detail, () =>
        this.options.toolBroker.run(
          {
            capability: "local.mcp.call",
            risk: "R2",
            title: trMain("ui.4e44bd178ca0", [title]),
            detail,
            auditDetail: `${resolved.server.serverId} · ${resolved.tool.name}`,
            approvalKey: `${resolved.server.serverId}:${resolved.tool.name}:${sha256(JSON.stringify(args))}`,
            projectId: localProjectId,
            approvalMode
          },
          async () => {
            throwIfAborted(signal);
            const current = await this.ensureOnline(resolved, localProjectId);
            throwIfAborted(signal);
            const result = await this.options.client.callMcpTool(
              current.server.serverId,
              current.tool.name,
              args
            );
            return {
              content: serializeToolResult(result),
              summary: `${current.server.name} · ${current.tool.title ?? current.tool.name}`
            };
          }
        )
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        content: JSON.stringify({
          error: {
            code: readErrorCode(error),
            message: error instanceof Error ? error.message : "Unknown MCP Tool error"
          }
        }),
        summary: error instanceof Error ? error.message : trMain("ui.f96ff9cd1312"),
        isError: true
      };
    }
  }

  private async resolve(
    localProjectId: string,
    dynamicName: string
  ): Promise<ResolvedMcpTool> {
    const servers = eligibleServers(
      await this.options.client.listMcpServers(),
      localProjectId
    );
    for (const server of servers) {
      const tool = server.tools.find(
        (candidate) => dynamicToolName(server.serverId, candidate.name) === dynamicName
      );
      if (tool) return { server, tool };
    }
    const error = new Error("The Local MCP Tool is no longer available in this project.");
    Object.assign(error, { code: "MCP_TOOL_NOT_AVAILABLE" });
    throw error;
  }

  private async ensureOnline(
    resolved: ResolvedMcpTool,
    localProjectId: string
  ): Promise<ResolvedMcpTool> {
    const currentServer = (await this.options.client.listMcpServers()).find(
      (server) => server.serverId === resolved.server.serverId
    );
    if (!currentServer) {
      const error = new Error("The Local MCP Server is no longer available.");
      Object.assign(error, { code: "MCP_SERVER_NOT_AVAILABLE" });
      throw error;
    }
    assertServerScope(currentServer, localProjectId);
    const currentTool = currentServer.tools.find(
      (candidate) => candidate.name === resolved.tool.name
    );
    if (!currentTool) {
      const error = new Error("The Local MCP Tool is no longer exposed by the server.");
      Object.assign(error, { code: "MCP_TOOL_NOT_FOUND" });
      throw error;
    }
    if (currentServer.status === "online") {
      return { server: currentServer, tool: currentTool };
    }

    const started = await this.options.client.startMcpServer(currentServer.serverId);
    assertServerScope(started, localProjectId);
    const tool = started.tools.find((candidate) => candidate.name === currentTool.name);
    if (!tool) {
      const error = new Error("The Local MCP Tool was not exposed after the server started.");
      Object.assign(error, { code: "MCP_TOOL_NOT_FOUND" });
      throw error;
    }
    return { server: started, tool };
  }

  private async runWithActivity(
    title: string,
    detail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
  ): Promise<ProjectChatToolExecution> {
    this.options.onActivity?.("job.started", title, detail);
    try {
      const result = await operation();
      this.options.onActivity?.("job.succeeded", title, result.summary);
      return { ...result, isError: false };
    } catch (error) {
      this.options.onActivity?.(
        "job.failed",
        title,
        error instanceof Error ? error.message : "Unknown MCP Tool error"
      );
      throw error;
    }
  }
}

function eligibleServers(
  servers: McpServerSummary[],
  localProjectId: string
): McpServerSummary[] {
  return servers.filter((server) => {
    if (!server.enabled || !server.tools.length) return false;
    return server.localProjectId === null || server.localProjectId === localProjectId;
  });
}

function assertServerScope(server: McpServerSummary, localProjectId: string): void {
  if (
    !server.enabled ||
    (server.localProjectId !== null && server.localProjectId !== localProjectId)
  ) {
    const error = new Error("The Local MCP Server is not available in this project.");
    Object.assign(error, { code: "MCP_PROJECT_SCOPE_INVALID" });
    throw error;
  }
}

function toToolDefinition(
  server: McpServerSummary,
  tool: McpTool
): ProjectChatToolDefinition {
  const title = tool.title ?? tool.name;
  const description = [
    `Local MCP Tool from ${server.name}: ${title}.`,
    tool.description?.trim()
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_DESCRIPTION_CHARACTERS);
  return {
    type: "function",
    function: {
      name: dynamicToolName(server.serverId, tool.name),
      description,
      parameters: normalizeInputSchema(tool.inputSchema)
    }
  };
}

function dynamicToolName(serverId: string, toolName: string): string {
  const hash = sha256(`${serverId}\0${toolName}`).slice(0, 12);
  const readable = `${sanitizeName(serverId)}_${sanitizeName(toolName)}`
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_FUNCTION_NAME_LENGTH - MCP_TOOL_PREFIX.length - hash.length - 1);
  return `${MCP_TOOL_PREFIX}${readable || "tool"}_${hash}`.slice(
    0,
    MAX_FUNCTION_NAME_LENGTH
  );
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_");
}

function normalizeInputSchema(value: Record<string, unknown>): Record<string, unknown> {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return genericObjectSchema();
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_SCHEMA_BYTES) {
    return genericObjectSchema();
  }
  let schema: Record<string, unknown>;
  try {
    const parsed = JSON.parse(encoded) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return genericObjectSchema();
    }
    schema = parsed as Record<string, unknown>;
  } catch {
    return genericObjectSchema();
  }
  if (schema.type !== undefined && schema.type !== "object") {
    return genericObjectSchema();
  }
  return {
    ...schema,
    type: "object",
    ...(schema.properties && typeof schema.properties === "object"
      ? {}
      : { properties: {} })
  };
}

function genericObjectSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    additionalProperties: true
  };
}

function parseArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MCP Tool arguments must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function serializeToolResult(result: Record<string, unknown>): string {
  const encoded = JSON.stringify(result);
  if (encoded.length <= MAX_TOOL_RESULT_CHARACTERS) return encoded;
  return JSON.stringify({
    result_preview: encoded.slice(0, MAX_TOOL_RESULT_CHARACTERS),
    truncated: true,
    original_characters: encoded.length
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "LOCAL_MCP_TOOL_ERROR";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("The Local MCP Tool operation was cancelled.");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
