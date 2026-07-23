import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { terminateProcessTree } from "./child-process";
import { WorkerError } from "./errors";
import type { McpRegistry, McpServerConfig } from "./mcp-registry";
import type { ProjectRegistry } from "./project-registry";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const SENSITIVE_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTH)/i;

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpServerSummary = McpServerConfig & {
  status: "offline" | "starting" | "online" | "error";
  tools: McpTool[];
  serverInfo: { name: string; version: string } | null;
  protocolVersion: string | null;
  stderr: string;
  lastError: string | null;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

type McpSession = {
  config: McpServerConfig;
  child: ChildProcessWithoutNullStreams | null;
  status: McpServerSummary["status"];
  tools: McpTool[];
  serverInfo: McpServerSummary["serverInfo"];
  protocolVersion: string | null;
  stderr: string;
  lastError: string | null;
  stdoutBuffer: string;
  nextId: number;
  pending: Map<number, PendingRequest>;
  httpSessionId: string | null;
};

export class StdioMcpHost {
  private readonly sessions = new Map<string, McpSession>();

  constructor(
    private readonly registry: McpRegistry,
    private readonly projects: ProjectRegistry,
    private readonly defaultCwd: string
  ) {}

  list(): McpServerSummary[] {
    return this.registry.list().map((config) => summarize(config, this.sessions.get(config.serverId)));
  }

  async start(serverId: string): Promise<McpServerSummary> {
    const config = this.registry.get(serverId);
    if (!config) throw new WorkerError("MCP_SERVER_NOT_FOUND", "MCP server was not found.");
    if (!config.enabled) throw new WorkerError("MCP_SERVER_DISABLED", "MCP server is disabled.");
    const existing = this.sessions.get(serverId);
    if (existing?.status === "online" || existing?.status === "starting") {
      return summarize(config, existing);
    }
    if (config.transport === "streamable-http") return this.startHttp(config);
    const cwd = config.localProjectId
      ? this.projects.get(config.localProjectId)?.realRootPath
      : this.defaultCwd;
    if (!cwd) throw new WorkerError("PROJECT_NOT_BOUND", "MCP project is not bound on this device.");

    const child = spawn(config.command, config.args, {
      cwd,
      env: sanitizedEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const session: McpSession = {
      config,
      child,
      status: "starting",
      tools: [],
      serverInfo: null,
      protocolVersion: null,
      stderr: "",
      lastError: null,
      stdoutBuffer: "",
      nextId: 1,
      pending: new Map(),
      httpSessionId: null
    };
    this.sessions.set(serverId, session);
    child.stdout.on("data", (chunk: Buffer) => this.onStdout(session, chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      session.stderr = appendBounded(session.stderr, chunk.toString("utf8"), MAX_STDERR_BYTES);
    });
    child.on("error", (error) => this.failSession(session, error));
    child.on("exit", (code, signal) => {
      session.child = null;
      if (session.status !== "error") {
        session.status = "offline";
        if (code && code !== 0) session.lastError = `MCP server exited with code ${code}${signal ? ` (${signal})` : ""}.`;
      }
      this.rejectPending(session, new WorkerError("MCP_SERVER_OFFLINE", "MCP server stopped."));
    });

    try {
      await waitForSpawn(child);
      const initialized = await this.request<{
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string; version: string };
      }>(session, "initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "RouteMarket Work", version: "0.1.0" }
      });
      session.protocolVersion = initialized.protocolVersion;
      session.serverInfo = initialized.serverInfo;
      await this.notify(session, "notifications/initialized");
      session.tools = await this.loadAllTools(session);
      session.status = "online";
      return summarize(config, session);
    } catch (error) {
      this.failSession(session, error instanceof Error ? error : new Error("MCP initialization failed."));
      await terminateProcessTree(child);
      throw error;
    }
  }

  async stop(serverId: string): Promise<McpServerSummary> {
    const config = this.registry.get(serverId);
    if (!config) throw new WorkerError("MCP_SERVER_NOT_FOUND", "MCP server was not found.");
    const session = this.sessions.get(serverId);
    if (session?.child) await terminateProcessTree(session.child);
    if (session?.config.transport === "streamable-http" && session.config.url) {
      await fetch(session.config.url, {
        method: "DELETE",
        headers: this.httpHeaders(session),
        redirect: "error",
        signal: AbortSignal.timeout(5_000)
      }).catch(() => undefined);
    }
    if (session) {
      session.child = null;
      session.status = "offline";
      this.rejectPending(session, new WorkerError("MCP_SERVER_OFFLINE", "MCP server stopped."));
    }
    return summarize(config, session);
  }

  async refreshTools(serverId: string): Promise<McpServerSummary> {
    const session = this.requireOnline(serverId);
    session.tools = await this.loadAllTools(session);
    return summarize(session.config, session);
  }

  async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const session = this.requireOnline(serverId);
    if (!session.tools.some((tool) => tool.name === name)) {
      throw new WorkerError("MCP_TOOL_NOT_FOUND", "MCP tool is not exposed by this server.");
    }
    const encoded = JSON.stringify(args);
    if (Buffer.byteLength(encoded, "utf8") > 1024 * 1024) {
      throw new WorkerError("TOOL_INPUT_INVALID", "MCP tool arguments exceed 1 MiB.");
    }
    return this.request<Record<string, unknown>>(session, "tools/call", { name, arguments: args });
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((serverId) => this.stop(serverId)));
  }

  private async startHttp(config: McpServerConfig): Promise<McpServerSummary> {
    if (!config.url) throw new WorkerError("MCP_PROTOCOL_ERROR", "Streamable HTTP MCP URL is missing.");
    const session: McpSession = {
      config,
      child: null,
      status: "starting",
      tools: [],
      serverInfo: null,
      protocolVersion: null,
      stderr: "",
      lastError: null,
      stdoutBuffer: "",
      nextId: 1,
      pending: new Map(),
      httpSessionId: null
    };
    this.sessions.set(config.serverId, session);
    try {
      const initialized = await this.request<{
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string; version: string };
      }>(session, "initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "RouteMarket Work", version: "0.1.0" }
      });
      if (!initialized || typeof initialized.protocolVersion !== "string") {
        throw new WorkerError("MCP_PROTOCOL_ERROR", "Invalid MCP initialize response.");
      }
      session.protocolVersion = initialized.protocolVersion;
      session.serverInfo = initialized.serverInfo;
      await this.notify(session, "notifications/initialized");
      session.tools = await this.loadAllTools(session);
      session.status = "online";
      return summarize(config, session);
    } catch (error) {
      this.failSession(session, error instanceof Error ? error : new Error("MCP initialization failed."));
      throw error;
    }
  }

  private requireOnline(serverId: string): McpSession {
    const session = this.sessions.get(serverId);
    if (
      !session || session.status !== "online" ||
      (session.config.transport === "stdio" && !session.child)
    ) {
      throw new WorkerError("MCP_SERVER_OFFLINE", "MCP server is not online.");
    }
    return session;
  }

  private async loadAllTools(session: McpSession): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.request<{ tools: McpTool[]; nextCursor?: string }>(
        session,
        "tools/list",
        cursor ? { cursor } : {}
      );
      if (!Array.isArray(result.tools)) throw new WorkerError("MCP_PROTOCOL_ERROR", "Invalid tools/list response.");
      for (const tool of result.tools) {
        if (!tool || typeof tool.name !== "string" || !tool.name || typeof tool.inputSchema !== "object") {
          throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP server returned an invalid Tool definition.");
        }
        tools.push(tool);
        if (tools.length > 1_000) throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP server exposes too many Tools.");
      }
      cursor = result.nextCursor;
      if (!cursor) return tools.sort((left, right) => left.name.localeCompare(right.name));
    }
    throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP tools/list pagination did not terminate.");
  }

  private async requestHttp<TResult>(
    session: McpSession,
    method: string,
    params: Record<string, unknown>
  ): Promise<TResult> {
    const id = session.nextId++;
    const response = await this.postHttp(session, { jsonrpc: "2.0", id, method, params });
    if (!response || response.id !== id) {
      throw new WorkerError("MCP_PROTOCOL_ERROR", `MCP HTTP response did not match request ${id}.`);
    }
    if (response.error && typeof response.error === "object") {
      const error = response.error as { code?: number; message?: string };
      throw new WorkerError(
        "MCP_REQUEST_FAILED",
        error.message ?? `MCP error ${error.code ?? "unknown"}`
      );
    }
    return response.result as TResult;
  }

  private async postHttp(
    session: McpSession,
    message: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    if (!session.config.url) throw new WorkerError("MCP_SERVER_OFFLINE", "MCP endpoint is unavailable.");
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded, "utf8") > MAX_MESSAGE_BYTES) {
      throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP message exceeds 4 MiB.");
    }
    let response: Response;
    try {
      response = await fetch(session.config.url, {
        method: "POST",
        headers: this.httpHeaders(session),
        body: encoded,
        redirect: "error",
        signal: AbortSignal.timeout(30_000)
      });
    } catch (error) {
      throw new WorkerError(
        "MCP_SERVER_OFFLINE",
        error instanceof Error ? error.message : "Streamable HTTP MCP request failed."
      );
    }
    const responseSessionId = response.headers.get("mcp-session-id");
    if (responseSessionId) {
      if (responseSessionId.length > 1_024 || /[\r\n]/.test(responseSessionId)) {
        throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP Session ID is invalid.");
      }
      session.httpSessionId = responseSessionId;
    }
    if (!response.ok) {
      throw new WorkerError("MCP_REQUEST_FAILED", `Streamable HTTP MCP returned ${response.status}.`);
    }
    if (response.status === 202 || response.status === 204) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_MESSAGE_BYTES) {
      throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP HTTP response exceeds 4 MiB.");
    }
    const text = buffer.toString("utf8");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    try {
      if (contentType.includes("text/event-stream")) return parseSseResponse(text);
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP HTTP response is not valid JSON-RPC.");
    }
  }

  private httpHeaders(session: McpSession): Record<string, string> {
    return {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(session.protocolVersion ? { "MCP-Protocol-Version": session.protocolVersion } : {}),
      ...(session.httpSessionId ? { "Mcp-Session-Id": session.httpSessionId } : {})
    };
  }

  private request<TResult>(
    session: McpSession,
    method: string,
    params: Record<string, unknown>
  ): Promise<TResult> {
    if (session.config.transport === "streamable-http") {
      return this.requestHttp<TResult>(session, method, params);
    }
    if (!session.child?.stdin.writable) {
      return Promise.reject(new WorkerError("MCP_SERVER_OFFLINE", "MCP server stdin is unavailable."));
    }
    const id = session.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new WorkerError("MCP_REQUEST_TIMEOUT", `MCP request timed out: ${method}`));
      }, 30_000);
      session.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer
      });
      try {
        this.write(session, { jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        session.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Failed to write MCP request."));
      }
    });
  }

  private async notify(session: McpSession, method: string): Promise<void> {
    if (session.config.transport === "streamable-http") {
      await this.postHttp(session, { jsonrpc: "2.0", method });
      return;
    }
    this.write(session, { jsonrpc: "2.0", method });
  }

  private write(session: McpSession, message: Record<string, unknown>): void {
    const encoded = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > MAX_MESSAGE_BYTES) {
      throw new WorkerError("MCP_PROTOCOL_ERROR", "MCP message exceeds 4 MiB.");
    }
    session.child?.stdin.write(encoded);
  }

  private onStdout(session: McpSession, chunk: Buffer): void {
    session.stdoutBuffer += chunk.toString("utf8");
    if (Buffer.byteLength(session.stdoutBuffer, "utf8") > MAX_MESSAGE_BYTES) {
      this.failSession(session, new WorkerError("MCP_PROTOCOL_ERROR", "MCP stdout message exceeds 4 MiB."));
      if (session.child) void terminateProcessTree(session.child);
      return;
    }
    let newline = session.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = session.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      session.stdoutBuffer = session.stdoutBuffer.slice(newline + 1);
      if (line) this.handleMessage(session, line);
      newline = session.stdoutBuffer.indexOf("\n");
    }
  }

  private handleMessage(session: McpSession, line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.failSession(session, new WorkerError("MCP_PROTOCOL_ERROR", "MCP server wrote non-JSON data to stdout."));
      if (session.child) void terminateProcessTree(session.child);
      return;
    }
    if (message.jsonrpc !== "2.0") return;
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = session.pending.get(message.id);
      if (!pending) return;
      session.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error && typeof message.error === "object") {
        const error = message.error as { code?: number; message?: string };
        pending.reject(new WorkerError("MCP_REQUEST_FAILED", error.message ?? `MCP error ${error.code ?? "unknown"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.id === "number" && typeof message.method === "string") {
      this.write(session, {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Client method not supported" }
      });
    }
  }

  private failSession(session: McpSession, error: Error): void {
    session.status = "error";
    session.lastError = error.message;
    this.rejectPending(session, error);
  }

  private rejectPending(session: McpSession, error: Error): void {
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pending.clear();
  }
}

function summarize(config: McpServerConfig, session?: McpSession): McpServerSummary {
  return {
    ...config,
    args: [...config.args],
    status: session?.status ?? "offline",
    tools: session?.tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } })) ?? [],
    serverInfo: session?.serverInfo ? { ...session.serverInfo } : null,
    protocolVersion: session?.protocolVersion ?? null,
    stderr: session?.stderr ?? "",
    lastError: session?.lastError ?? null
  };
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => value !== undefined && !SENSITIVE_ENV.test(name))
  );
}

function appendBounded(current: string, addition: string, maxBytes: number): string {
  const buffer = Buffer.from(current + addition, "utf8");
  return buffer.byteLength <= maxBytes
    ? buffer.toString("utf8")
    : buffer.subarray(buffer.byteLength - maxBytes).toString("utf8");
}

function parseSseResponse(value: string): Record<string, unknown> {
  for (const block of value.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed.jsonrpc === "2.0") return parsed;
  }
  throw new Error("No JSON-RPC SSE event was returned.");
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}
