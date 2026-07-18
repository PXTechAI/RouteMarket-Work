import { describe, expect, it, vi } from "vitest";
import type {
  DesktopWorkflowDraftNode,
  ManagedProcessSummary,
  McpServerSummary,
  ProjectContext
} from "../shared/desktop-api";
import { createLocalWorkflowNodeExecutor } from "./local-workflow-node-executor";
import type { ManagedBrowserManager } from "./managed-browser-manager";
import type { NativeAppConnectorManager } from "./native-app-connector-manager";
import { LocalToolBroker } from "./tool-broker";
import type { WorkerClient } from "./worker-client";

const projectId = "project_test";

describe("createLocalWorkflowNodeExecutor", () => {
  it("resolves the original project Skill ID from its sanitized executor key", async () => {
    const workerClient = createWorkerClient({
      skills: [skill("设计 / 文档")]
    });
    const executor = createExecutor(workerClient);

    await executor(
      node("skill.local._"),
      { $localProjectId: projectId, task: "整理文档" },
      new AbortController().signal
    );

    expect(workerClient.projectContext).toHaveBeenCalledWith(projectId);
    expect(workerClient.invokeProjectSkill).toHaveBeenCalledWith(
      projectId,
      "设计 / 文档",
      "整理文档"
    );
  });

  it("does not allow node input to select a different project Skill", async () => {
    const workerClient = createWorkerClient({
      skills: [skill("review"), skill("publish")]
    });
    const executor = createExecutor(workerClient);

    await expect(
      executor(
        node("skill.local.review"),
        {
          $localProjectId: projectId,
          skillId: "publish",
          task: "Publish this"
        },
        new AbortController().signal
      )
    ).rejects.toThrow("not authorized");
    expect(workerClient.invokeProjectSkill).not.toHaveBeenCalled();
  });

  it("only stops managed processes belonging to the current project", async () => {
    const workerClient = createWorkerClient();
    workerClient.listProcesses.mockResolvedValue([{
      processId: "process_other",
      localProjectId: "project_other",
      executable: "cmd.exe",
      args: [],
      status: "running",
      pid: 42,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      outputTruncated: false
    }]);
    const executor = createExecutor(workerClient);

    await expect(
      executor(
        node("local.process.stop"),
        { $localProjectId: projectId, processId: "process_other" },
        new AbortController().signal
      )
    ).rejects.toThrow("not found in this project");
    expect(workerClient.stopProcess).not.toHaveBeenCalled();
  });

  it("rejects project-scoped MCP Tools from another project", async () => {
    const server = mcpServer({
      localProjectId: "project_other",
      tools: [{
        name: "write cells",
        description: "Write cells",
        inputSchema: { type: "object" }
      }]
    });
    const workerClient = createWorkerClient({ mcpServers: [server] });
    const executor = createExecutor(workerClient);

    await expect(
      executor(
        node("mcp__server_test__write_cells"),
        { $localProjectId: projectId, range: "A1" },
        new AbortController().signal
      )
    ).rejects.toThrow("not authorized for this project");
    expect(workerClient.callMcpTool).not.toHaveBeenCalled();
  });

  it("routes sensitive MCP calls through project-scoped approval", async () => {
    const confirm = vi.fn(async () => true);
    const server = mcpServer({
      status: "offline",
      tools: [{
        name: "write cells",
        description: "Write cells",
        inputSchema: { type: "object" }
      }]
    });
    const workerClient = createWorkerClient({ mcpServers: [server] });
    const executor = createExecutor(workerClient, confirm);

    await executor(
      node("mcp__server_test__write_cells"),
      { $localProjectId: projectId, range: "A1", value: "Ready" },
      new AbortController().signal
    );

    expect(workerClient.startMcpServer).toHaveBeenCalledWith("server test");
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.mcp.call",
      risk: "R2",
      projectId
    }));
    expect(workerClient.callMcpTool).toHaveBeenCalledWith(
      "server test",
      "write cells",
      { range: "A1", value: "Ready" }
    );
  });

  it("uploads project files through R3 project approval", async () => {
    const confirm = vi.fn(async () => true);
    const upload = vi.fn(async (
      _localProjectId: string,
      _selector: string,
      relativePaths: string[],
      _pageId?: string
    ) => ({
      completed: true as const,
      pageId: "page_1",
      url: "https://example.com/upload",
      relativePaths
    }));
    const browser = { upload } as unknown as ManagedBrowserManager;
    const executor = createExecutor(createWorkerClient(), confirm, browser);

    const result = await executor(
      node("local.browser.upload"),
      {
        $localProjectId: projectId,
        selector: "input[type=file]",
        relativePaths: ["assets/report.pdf", "exports/data.csv"],
        pageId: "page_1"
      },
      new AbortController().signal
    );

    expect(result).toEqual({
      completed: true,
      pageId: "page_1",
      url: "https://example.com/upload",
      relativePaths: ["assets/report.pdf", "exports/data.csv"]
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.browser.upload",
      risk: "R3",
      projectId
    }));
    expect(upload).toHaveBeenCalledWith(
      projectId,
      "input[type=file]",
      ["assets/report.pdf", "exports/data.csv"],
      "page_1",
      { source: "workflow" }
    );
  });
});

function createExecutor(
  workerClient: ReturnType<typeof createWorkerClient>,
  confirm = vi.fn(async () => true),
  browser = {} as ManagedBrowserManager
) {
  return createLocalWorkflowNodeExecutor({
    workerClient: workerClient as unknown as WorkerClient,
    toolBroker: new LocalToolBroker(confirm),
    getBrowser: () => browser,
    nativeAppConnectors: {} as NativeAppConnectorManager
  });
}

function createWorkerClient(input?: {
  skills?: ProjectContext["skills"];
  mcpServers?: McpServerSummary[];
}) {
  return {
    projectContext: vi.fn(async () => projectContext(input?.skills ?? [])),
    invokeProjectSkill: vi.fn(async () => ({ completed: true })),
    listProcesses: vi.fn(async (): Promise<ManagedProcessSummary[]> => []),
    stopProcess: vi.fn(async () => ({ completed: true })),
    listMcpServers: vi.fn(async () => input?.mcpServers ?? []),
    startMcpServer: vi.fn(async () => ({ completed: true })),
    callMcpTool: vi.fn(async () => ({ completed: true }))
  };
}

function projectContext(skills: ProjectContext["skills"]): ProjectContext {
  return {
    instructions: null,
    readme: null,
    settings: {
      defaultAgent: null,
      defaultModel: null,
      cloudProjectId: null,
      ignore: []
    },
    skills
  };
}

function skill(id: string): ProjectContext["skills"][number] {
  return {
    id,
    name: id,
    description: id,
    relativePath: `.routemarket/skills/${id}/SKILL.md`
  };
}

function mcpServer(
  overrides: Partial<McpServerSummary> = {}
): McpServerSummary {
  return {
    serverId: "server test",
    name: "Test server",
    transport: "stdio",
    command: "test",
    args: [],
    url: null,
    localProjectId: projectId,
    enabled: true,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    status: "online",
    tools: [],
    serverInfo: null,
    protocolVersion: null,
    stderr: "",
    lastError: null,
    ...overrides
  };
}

function node(executorKey: string): DesktopWorkflowDraftNode {
  return {
    nodeId: "node_test",
    executorKey,
    title: executorKey,
    executionTarget: "desktop",
    x: 0,
    y: 0,
    config: {},
    definitionSnapshot: {
      executorKey,
      definitionVersion: 1,
      source: "local_extension",
      executionTarget: "desktop",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredCapabilities: [executorKey],
      portability: "requires_connector",
      definitionHash: `sha256:${"a".repeat(64)}`,
      title: executorKey,
      description: executorKey,
      available: true,
      blockedReason: null
    }
  };
}
