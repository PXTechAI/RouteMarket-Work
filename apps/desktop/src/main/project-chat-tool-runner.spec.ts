import { describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@routemarket/work-protocol";
import type {
  ManagedBrowserState,
  ManagedProcessSummary,
  ProjectContext
} from "../shared/desktop-api";
import { LocalToolBroker } from "./tool-broker";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";
import { PROJECT_CHAT_TOOLS } from "./project-chat-tools";
import type { WorkerClient } from "./worker-client";

const projectProcess: ManagedProcessSummary = {
  processId: "process_1",
  localProjectId: "project_1",
  executable: "pnpm",
  args: ["test"],
  status: "exited",
  pid: 123,
  exitCode: 0,
  signal: null,
  stdout: "Tests passed",
  stderr: "",
  outputTruncated: false,
  startedAt: "2026-07-18T07:00:00.000Z",
  finishedAt: "2026-07-18T07:00:01.000Z"
};

const browserState: ManagedBrowserState = {
  localProjectId: "project_1",
  visible: false,
  activeProfileId: "profile_default",
  activePageId: "page_1",
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  userTakeover: false,
  crashed: false,
  downloads: [],
  operations: [],
  profiles: [{
    profileId: "profile_default",
    localProjectId: "project_1",
    name: "Default",
    userAgent: "secret-user-agent",
    proxyRules: "http://secret-proxy.test:8080",
    proxyBypassRules: "",
    persistence: "persistent"
  }],
  pages: [{
    pageId: "page_1",
    profileId: "profile_default",
    localProjectId: "project_1",
    title: "Example",
    url: "https://example.com/",
    loading: false,
    crashed: false
  }]
};

function createWorker() {
  return {
    listProjectFiles: vi.fn(async () => ({
      entries: [{
        name: "src",
        relativePath: "src",
        kind: "directory" as const,
        children: [{
          name: "index.ts",
          relativePath: "src/index.ts",
          kind: "file" as const
        }]
      }],
      totalEntries: 2,
      truncated: false
    })),
    searchProject: vi.fn(async (_projectId: string, query: string) => ({
      query,
      matches: [],
      filesScanned: 3,
      truncated: false
    })),
    readProjectFile: vi.fn(async () => ({
      uri: "routemarket-work://project/project_1/src/index.ts",
      text: "old",
      bytesRead: 3,
      truncated: false,
      encoding: "utf8" as const,
      sha256: "a".repeat(64)
    })),
    writeProjectFile: vi.fn(async () => ({
      uri: "routemarket-work://project/project_1/src/index.ts",
      text: "new",
      bytesRead: 3,
      truncated: false,
      encoding: "utf8" as const,
      sha256: "b".repeat(64),
      previousSha256: "a".repeat(64),
      changed: true
    })),
    createProjectFile: vi.fn(async () => ({
      uri: "routemarket-work://project/project_1/src/new.ts",
      text: "new",
      bytesRead: 3,
      truncated: false,
      encoding: "utf8" as const,
      sha256: "b".repeat(64),
      created: true as const
    })),
    createProjectSpreadsheet: vi.fn(async (
      input: Parameters<WorkerClient["createProjectSpreadsheet"]>[0]
    ) => ({
      uri: `routemarket-work://project/project_1/${input.relativePath}`,
      relativePath: input.relativePath,
      filename: input.relativePath.split("/").at(-1)!,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
      bytes: 4_096,
      sha256: `sha256:${"c".repeat(64)}`,
      sheetName: input.sheetName ?? "Sheet1",
      rowCount: input.rows.length,
      columnCount: Math.max(...input.rows.map((row) => row.length))
    })),
    inspectProjectSpreadsheet: vi.fn(async (
      input: Parameters<WorkerClient["inspectProjectSpreadsheet"]>[0]
    ) => ({
      uri: `project://${input.localProjectId}/${input.relativePath}`,
      relativePath: input.relativePath,
      filename: input.relativePath.split("/").at(-1)!,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
      bytes: 4_096,
      sha256: `sha256:${"c".repeat(64)}`,
      sheets: [{ id: "rId1", name: input.sheetName ?? "Data" }],
      activeSheetId: "rId1",
      activeSheetName: input.sheetName ?? "Data",
      usedRange: "A1:B3",
      rowCount: 3,
      columnCount: 2,
      truncated: false
    })),
    readProjectSpreadsheetRange: vi.fn(async (
      input: Parameters<WorkerClient["readProjectSpreadsheetRange"]>[0]
    ) => ({
      uri: `project://${input.localProjectId}/${input.relativePath}`,
      relativePath: input.relativePath,
      filename: input.relativePath.split("/").at(-1)!,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
      bytes: 4_096,
      sha256: `sha256:${"c".repeat(64)}`,
      sheets: [{ id: "rId1", name: input.sheetName ?? "Data" }],
      activeSheetId: "rId1",
      activeSheetName: input.sheetName ?? "Data",
      usedRange: "A1:B3",
      rowCount: 3,
      columnCount: 2,
      truncated: false,
      range: input.range,
      rows: [["Name", "Value"], ["Alpha", "1"]]
    })),
    writeProjectSpreadsheetRange: vi.fn(async (
      input: Parameters<WorkerClient["writeProjectSpreadsheetRange"]>[0]
    ) => ({
      uri: `project://${input.localProjectId}/${input.relativePath}`,
      relativePath: input.relativePath,
      filename: input.relativePath.split("/").at(-1)!,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
      bytes: 4_200,
      previousSha256: input.expectedSha256,
      sha256: `sha256:${"d".repeat(64)}`,
      changed: true,
      sheetName: input.sheetName ?? "Data",
      range: input.range.includes(":") ? input.range : `${input.range}:${input.range}`,
      rowCount: input.rows.length,
      columnCount: Math.max(...input.rows.map((row) => row.length))
    })),
    exportProjectSpreadsheetCsv: vi.fn(async (
      input: Parameters<WorkerClient["exportProjectSpreadsheetCsv"]>[0]
    ) => ({
      uri: `project://${input.localProjectId}/${input.outputPath}`,
      relativePath: input.outputPath,
      filename: input.outputPath.split("/").at(-1)!,
      mimeType: "text/csv" as const,
      bytes: 128,
      sha256: `sha256:${"e".repeat(64)}`,
      sheetName: input.sheetName ?? "Data",
      range: input.range ?? "A1:B3",
      rowCount: 3,
      columnCount: 2
    })),
    startProcess: vi.fn(async () => projectProcess),
    listProcesses: vi.fn(async () => [
      projectProcess,
      { ...projectProcess, processId: "process_other", localProjectId: "project_2" }
    ]),
    stopProcess: vi.fn(async () => ({ ...projectProcess, status: "stopped" as const }))
  };
}

function createBrowser() {
  const assertPage = (projectId: string, pageId?: string) => {
    if (projectId !== "project_1" || (pageId && pageId !== "page_1")) {
      const error = new Error("Browser page not found.");
      Object.assign(error, { code: "BROWSER_PAGE_NOT_FOUND" });
      throw error;
    }
  };
  return {
    getState: vi.fn(async (projectId: string) => {
      assertPage(projectId);
      return browserState;
    }),
    getPageState: vi.fn(async (projectId: string, pageId?: string) => {
      assertPage(projectId, pageId);
      return browserState;
    }),
    createPage: vi.fn(async () => browserState),
    selectPage: vi.fn(async () => browserState),
    setUserTakeover: vi.fn(async () => browserState),
    navigate: vi.fn(async (_projectId: string, url: string) => ({
      ...browserState,
      url,
      title: "Navigated"
    })),
    click: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    upload: vi.fn(async (
      _projectId: string,
      _selector: string,
      relativePaths: string[]
    ) => ({
      completed: true as const,
      pageId: "page_1",
      url: "https://example.com/",
      relativePaths
    })),
    extract: vi.fn(async () => "Extracted page text")
  };
}

function createSkillClient() {
  const projectContext: ProjectContext = {
    instructions: null,
    readme: null,
    settings: {
      defaultAgent: null,
      defaultModel: null,
      cloudProjectId: null,
      ignore: []
    },
    skills: [{
      id: "review",
      name: "Code review",
      description: "Review project changes.",
      relativePath: ".routemarket/skills/review/SKILL.md"
    }]
  };
  return {
    projectContext: vi.fn(async () => projectContext),
    invokeProjectSkill: vi.fn(async (
      _localProjectId: string,
      _skillId: string,
      task: string
    ) => ({
      skillId: "review",
      name: "Code review",
      description: "Review project changes.",
      relativePath: ".routemarket/skills/review/SKILL.md",
      task,
      instructions: "Inspect changes and report findings by severity.",
      truncated: false,
      directive:
        "Apply these Skill instructions to the current task. Use separately authorized local Tools for concrete actions."
    }))
  };
}

describe("ProjectChatToolRunner", () => {
  it("exposes Spreadsheet through the Plugin registry without the development-only legacy name", async () => {
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true)
    });

    const tools = await runner.listTools("project_1");
    const names = tools.map((tool) => tool.function.name);
    const spreadsheet = tools.find((tool) => tool.function.name === "spreadsheet");

    expect(names).toContain("spreadsheet");
    expect(names).not.toContain("spreadsheet_create");
    expect(spreadsheet?.function.parameters.required).toEqual(["operation", "path"]);
  });

  it("routes spreadsheet create through the Plugin runtime and returns a conversation artifact", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_spreadsheet",
      name: "spreadsheet",
      arguments: JSON.stringify({
        operation: "create",
        path: "reports/multiplication.xlsx",
        sheet_name: "乘法口诀",
        rows: [["×", 1, 2], [1, "1×1=1", "1×2=2"]],
        freeze_pane: "A2",
        column_widths: [12, 18, 18]
      })
    });

    expect(result).toMatchObject({
      isError: false,
      artifacts: [{
        filename: "multiplication.xlsx",
        relativePath: "reports/multiplication.xlsx",
        providerId: "ai.routemarket.spreadsheet"
      }]
    });
    expect(JSON.parse(result.content)).toMatchObject({
      operation: "create",
      created: true,
      output_files: [{ relative_path: "reports/multiplication.xlsx" }]
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.spreadsheet.write",
      risk: "R2",
      projectId: "project_1"
    }));
    expect(worker.createProjectSpreadsheet).toHaveBeenCalledWith(expect.objectContaining({
      localProjectId: "project_1",
      relativePath: "reports/multiplication.xlsx",
      sheetName: "乘法口诀",
      freezePane: "A2",
      columnWidths: [12, 18, 18]
    }));
  });

  it("rejects spreadsheet calls that omit the explicit operation", async () => {
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(async () => true)
    });

    const result = await runner.execute("project_1", {
      id: "call_spreadsheet_invalid",
      name: "spreadsheet",
      arguments: JSON.stringify({ path: "report.xlsx", rows: [[1]] })
    });

    expect(result.isError).toBe(true);
    expect(worker.createProjectSpreadsheet).not.toHaveBeenCalled();
  });

  it("runs spreadsheet inspect and read_range at R0 without prompting", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const inspected = await runner.execute("project_1", {
      id: "call_spreadsheet_inspect",
      name: "spreadsheet",
      arguments: JSON.stringify({ operation: "inspect", path: "table.xlsx" })
    });
    const read = await runner.execute("project_1", {
      id: "call_spreadsheet_read",
      name: "spreadsheet",
      arguments: JSON.stringify({ operation: "read_range", path: "table.xlsx", range: "A1:B2" })
    });

    expect(inspected.isError).toBe(false);
    expect(JSON.parse(inspected.content)).toMatchObject({ operation: "inspect", used_range: "A1:B3" });
    expect(read.isError).toBe(false);
    expect(JSON.parse(read.content)).toMatchObject({ operation: "read_range", range: "A1:B2" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("guards spreadsheet write_range with R2 approval and returns the updated workbook", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });
    const expectedSha256 = `sha256:${"c".repeat(64)}`;

    const result = await runner.execute("project_1", {
      id: "call_spreadsheet_write",
      name: "spreadsheet",
      arguments: JSON.stringify({
        operation: "write_range",
        path: "table.xlsx",
        sheet_name: "Data",
        range: "B2",
        rows: [[42]],
        expected_sha256: expectedSha256
      })
    });

    expect(result).toMatchObject({
      isError: false,
      artifacts: [{ relativePath: "table.xlsx", providerId: "ai.routemarket.spreadsheet" }]
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.spreadsheet.write",
      risk: "R2",
      projectId: "project_1"
    }));
    expect(worker.writeProjectSpreadsheetRange).toHaveBeenCalledWith(expect.objectContaining({
      range: "B2",
      rows: [[42]],
      expectedSha256
    }));
  });

  it("exports spreadsheet CSV through R2 approval and returns a new file artifact", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_spreadsheet_export",
      name: "spreadsheet",
      arguments: JSON.stringify({
        operation: "export_csv",
        path: "table.xlsx",
        output_path: "exports/table.csv",
        range: "A1:B3"
      })
    });

    expect(result).toMatchObject({
      isError: false,
      artifacts: [{ filename: "table.csv", mimeType: "text/csv" }]
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.spreadsheet.write",
      risk: "R2"
    }));
  });

  it("runs project reads at R0 without prompting", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_1",
      name: "project_read_file",
      arguments: '{"path":"src/index.ts"}'
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      path: "src/index.ts",
      text: "old",
      sha256: "a".repeat(64)
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(worker.readProjectFile).toHaveBeenCalledWith(
      "project_1",
      "src/index.ts"
    );
  });

  it("requires Tool Broker approval before writing a project file", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_2",
      name: "project_write_file",
      arguments: JSON.stringify({
        path: "src/index.ts",
        text: "new",
        expected_sha256: "a".repeat(64)
      })
    });

    expect(result).toMatchObject({
      isError: false,
      summary: "已修改 src/index.ts"
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "local.fs.write",
        risk: "R1",
        projectId: "project_1"
      })
    );
    expect(worker.writeProjectFile).toHaveBeenCalledWith(
      "project_1",
      "src/index.ts",
      "new",
      "a".repeat(64)
    );
  });

  it("returns a structured error and does not execute invalid arguments", async () => {
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(async () => true)
    });

    const result = await runner.execute("project_1", {
      id: "call_3",
      name: "project_write_file",
      arguments: '{"path":"src/index.ts","text":"new","expected_sha256":"bad"}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: {
        code: "LOCAL_TOOL_ERROR"
      }
    });
    expect(worker.writeProjectFile).not.toHaveBeenCalled();
  });

  it("starts a project process through R2 approval with separate arguments", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_4",
      name: "project_start_process",
      arguments: JSON.stringify({
        executable: "pnpm",
        args: ["test"],
        wait_ms: 0
      })
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      process_id: "process_1",
      executable: "pnpm",
      args: ["test"],
      status: "exited",
      stdout: "Tests passed"
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "local.process.start",
        risk: "R2",
        projectId: "project_1"
      })
    );
    expect(worker.startProcess).toHaveBeenCalledWith(
      "project_1",
      "pnpm",
      ["test"]
    );
  });

  it("lists only processes belonging to the current project", async () => {
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(async () => true)
    });

    const result = await runner.execute("project_1", {
      id: "call_5",
      name: "project_list_processes",
      arguments: "{}"
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content).processes).toEqual([
      expect.objectContaining({ process_id: "process_1" })
    ]);
  });

  it("does not stop a process owned by another project", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_6",
      name: "project_stop_process",
      arguments: '{"process_id":"process_other"}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "PROCESS_NOT_FOUND" }
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(worker.stopProcess).not.toHaveBeenCalled();
  });

  it("stops a current-project process through R2 approval", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_7",
      name: "project_stop_process",
      arguments: '{"process_id":"process_1"}'
    });

    expect(result).toMatchObject({
      isError: false,
      summary: "已停止 pnpm · process_1"
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "local.process.stop",
        risk: "R2",
        projectId: "project_1"
      })
    );
    expect(worker.stopProcess).toHaveBeenCalledWith("process_1");
  });

  it("cancels waiting for process output without stopping the started process", async () => {
    const worker = createWorker();
    const runningProcess = {
      ...projectProcess,
      status: "running" as const,
      exitCode: null,
      finishedAt: null
    };
    worker.startProcess.mockResolvedValue(runningProcess);
    worker.listProcesses.mockResolvedValue([runningProcess]);
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(async () => true)
    });
    const controller = new AbortController();

    const pending = runner.execute(
      "project_1",
      {
        id: "call_8",
        name: "project_start_process",
        arguments: JSON.stringify({
          executable: "pnpm",
          args: ["dev"],
          wait_ms: 15_000
        })
      },
      controller.signal
    );
    await vi.waitFor(() => expect(worker.startProcess).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.stopProcess).not.toHaveBeenCalled();
  });

  it("navigates an Agent-controlled project page through R1 approval", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_1",
      name: "browser_navigate",
      arguments: '{"url":"https://routemarket.ai/docs","page_id":"page_1"}'
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      active_page_id: "page_1",
      url: "https://routemarket.ai/docs",
      user_takeover: false,
      profile_ids: ["profile_default"]
    });
    expect(result.content).not.toContain("secret-user-agent");
    expect(result.content).not.toContain("secret-proxy");
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "local.browser.navigate",
        risk: "R1",
        projectId: "project_1"
      })
    );
    expect(browser.navigate).toHaveBeenCalledWith(
      "project_1",
      "https://routemarket.ai/docs",
      "page_1",
      { source: "chat" }
    );
    expect(browser.selectPage).toHaveBeenCalledWith("project_1", "page_1");
  });

  it("creates a browser page under Agent control", async () => {
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_2",
      name: "browser_create_page",
      arguments: '{"url":"https://example.com"}'
    });

    expect(result.isError).toBe(false);
    expect(browser.createPage).toHaveBeenCalledWith(
      "project_1",
      undefined,
      "https://example.com"
    );
    expect(browser.setUserTakeover).toHaveBeenCalledWith(
      "project_1",
      false,
      "page_1",
      { source: "chat" }
    );
  });

  it("runs browser click and type through R2 approval without returning typed text", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const clicked = await runner.execute("project_1", {
      id: "call_browser_3",
      name: "browser_click",
      arguments: '{"selector":"button[type=submit]","page_id":"page_1"}'
    });
    const typed = await runner.execute("project_1", {
      id: "call_browser_4",
      name: "browser_type",
      arguments: '{"selector":"#password","text":"private value","page_id":"page_1"}'
    });

    expect(clicked.isError).toBe(false);
    expect(typed.isError).toBe(false);
    expect(JSON.parse(typed.content)).toMatchObject({
      completed: true,
      characters: 13
    });
    expect(typed.content).not.toContain("private value");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ capability: "local.browser.click", risk: "R2" })
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ capability: "local.browser.type", risk: "R2" })
    );
  });

  it("uploads project files through R3 project approval", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_upload",
      name: "browser_upload",
      arguments: JSON.stringify({
        selector: "input[type=file]",
        relative_paths: ["assets/report.pdf", "exports/data.csv"],
        page_id: "page_1"
      })
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({
      completed: true,
      page_id: "page_1",
      url: "https://example.com/",
      relative_paths: ["assets/report.pdf", "exports/data.csv"]
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.browser.upload",
      risk: "R3",
      projectId: "project_1"
    }));
    expect(browser.upload).toHaveBeenCalledWith(
      "project_1",
      "input[type=file]",
      ["assets/report.pdf", "exports/data.csv"],
      "page_1",
      { source: "chat" }
    );
  });

  it("clips extracted browser text to the Tool Result limit", async () => {
    const browser = createBrowser();
    browser.extract.mockResolvedValue("x".repeat(200_000));
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_5",
      name: "browser_extract",
      arguments: '{"selector":"main","page_id":"page_1"}'
    });
    const content = JSON.parse(result.content);

    expect(result.isError).toBe(false);
    expect(content.text).toHaveLength(160_000);
    expect(content.truncated).toBe(true);
  });

  it("rejects pages outside the current project before prompting", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_6",
      name: "browser_click",
      arguments: '{"selector":"button","page_id":"page_other"}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "BROWSER_PAGE_NOT_FOUND" }
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(browser.click).not.toHaveBeenCalled();
  });

  it("does not let AI operate a page while the user has taken over", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    browser.getPageState.mockResolvedValue({
      ...browserState,
      userTakeover: true
    });
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_7",
      name: "browser_navigate",
      arguments: '{"url":"https://example.com/account"}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "BROWSER_USER_TAKEOVER" }
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(browser.navigate).not.toHaveBeenCalled();
  });

  it("keeps fixed chat tools available when Local MCP discovery fails", async () => {
    const onActivity = vi.fn();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      mcpClient: {
        listMcpServers: vi.fn(async () => {
          throw new Error("MCP Worker unavailable.");
        }),
        startMcpServer: vi.fn(),
        callMcpTool: vi.fn()
      },
      onActivity
    });

    const tools = await runner.listTools("project_1");
    expect(tools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining([
      ...PROJECT_CHAT_TOOLS.map((tool) => tool.function.name),
      "spreadsheet"
    ]));
    expect(onActivity).toHaveBeenCalledWith(
      "job.failed",
      "Local MCP Tools 暂不可用",
      "MCP Worker unavailable."
    );
  });

  it("combines fixed, project Skill and Local MCP definitions", async () => {
    const skillClient = createSkillClient();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      skillClient,
      mcpClient: {
        listMcpServers: vi.fn(async () => [{
          serverId: "server_1",
          localProjectId: "project_1",
          name: "Project MCP",
          transport: "stdio" as const,
          command: "project-mcp",
          args: [],
          url: null,
          enabled: true,
          createdAt: "2026-07-18T08:00:00.000Z",
          updatedAt: "2026-07-18T08:00:00.000Z",
          status: "online" as const,
          tools: [{
            name: "inspect",
            title: "Inspect",
            description: "Inspect project state.",
            inputSchema: { type: "object", properties: {} }
          }],
          serverInfo: { name: "Project MCP", version: "1.0.0" },
          protocolVersion: "2025-06-18",
          stderr: "",
          lastError: null
        }]),
        startMcpServer: vi.fn(),
        callMcpTool: vi.fn()
      }
    });

    const tools = await runner.listTools("project_1");
    const names = tools.map((tool) => tool.function.name);

    expect(names).toEqual(expect.arrayContaining([
      "project_read_file",
      expect.stringMatching(/^skill_local_/),
      expect.stringMatching(/^mcp_local_/)
    ]));
  });

  it("keeps fixed and MCP tools available when project Skill discovery fails", async () => {
    const onActivity = vi.fn();
    const skillClient = createSkillClient();
    skillClient.projectContext.mockRejectedValue(new Error("Skill Worker unavailable."));
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      skillClient,
      mcpClient: {
        listMcpServers: vi.fn(async () => []),
        startMcpServer: vi.fn(),
        callMcpTool: vi.fn()
      },
      onActivity
    });

    const tools = await runner.listTools("project_1");
    expect(tools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining([
      ...PROJECT_CHAT_TOOLS.map((tool) => tool.function.name),
      "spreadsheet"
    ]));
    expect(onActivity).toHaveBeenCalledWith(
      "job.failed",
      "项目 Skills 暂不可用",
      "Skill Worker unavailable."
    );
  });

  it("delegates dynamic Skill calls to the project Skill Runtime", async () => {
    const skillClient = createSkillClient();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      skillClient
    });
    const tools = await runner.listTools("project_1");
    const skillTool = tools.find((tool) =>
      tool.function.name.startsWith("skill_local_")
    );

    const result = await runner.execute("project_1", {
      id: "call_skill",
      name: skillTool!.function.name,
      arguments: '{"task":"Review current changes."}'
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      skill_id: "review",
      task: "Review current changes.",
      instructions: "Inspect changes and report findings by severity."
    });
    expect(skillClient.invokeProjectSkill).toHaveBeenCalledWith(
      "project_1",
      "review",
      "Review current changes."
    );
  });

  it("activates and removes signed declarative tools through host capability adapters", async () => {
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true)
    });
    const manifest = {
      schemaVersion: 1,
      id: "ai.example.tables",
      name: "Tables",
      description: "Spreadsheet helper.",
      version: "1.0.0",
      publisher: "Example",
      kind: "declarative_plugin",
      status: "available",
      distribution: { source: "marketplace", packageFormat: "declarative" },
      engines: { routemarketWork: ">=0.2.0" },
      permissions: ["project.read", "project.write", "artifact.write"],
      activationEvents: ["onTool:tables"],
      contributes: {
        viewers: [],
        tools: [{ name: "tables", title: "Tables", status: "available", description: "Work with tables.", capability: "local.spreadsheet.write", risk: "R2" }],
        workflowNodes: [],
        connectors: []
      }
    } as const satisfies PluginManifest;

    runner.setMarketplacePluginManifests([manifest]);
    expect((await runner.listTools("project_1")).map((tool) => tool.function.name)).toContain("tables");

    runner.setMarketplacePluginManifests([]);
    expect((await runner.listTools("project_1")).map((tool) => tool.function.name)).not.toContain("tables");
  });
});
