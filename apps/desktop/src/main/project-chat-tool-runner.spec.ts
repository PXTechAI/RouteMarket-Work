import { describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@routemarket/work-protocol";
import type {
  ManagedBrowserState,
  ManagedProcessSummary,
  ProjectContext
} from "../shared/desktop-api";
import { LocalToolBroker } from "./tool-broker";
import type { ManagedBrowserManager } from "./managed-browser-manager";
import type { AttachedBrowserManager } from "./attached-browser-manager";
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
    createProjectFile: vi.fn<WorkerClient["createProjectFile"]>(async (
      _localProjectId: string,
      _relativePath: string,
      _text: string
    ) => ({
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
    setUserTakeover: vi.fn(async (
      _projectId: string,
      value: boolean
    ) => ({ ...browserState, userTakeover: value })),
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
    extract: vi.fn(async () => "Extracted page text"),
    clickPoint: vi.fn(async () => undefined),
    clickRef: vi.fn(async (_projectId: string, refId: string) => ({
      completed: true as const,
      pageId: "page_1",
      refId,
      urlBefore: "https://example.com/",
      urlAfter: "https://example.com/",
      navigated: false,
      target: {
        tag: "button",
        role: "button",
        name: "Sign in",
        inputType: null,
        x: 170,
        y: 96
      }
    })),
    scroll: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    typeRef: vi.fn(async (_projectId: string, refId: string) => ({
      completed: true as const,
      pageId: "page_1",
      refId,
      urlBefore: "https://example.com/",
      urlAfter: "https://example.com/",
      navigated: false,
      target: {
        tag: "input",
        role: "textbox",
        name: "Email",
        inputType: "email",
        x: 170,
        y: 130
      }
    })),
    inspect: vi.fn(async () => ({
      pageId: "page_1",
      url: "https://example.com/",
      title: "Example",
      text: "Example Sign in",
      elements: [{
        index: 0,
        refId: "element_0123456789abcdefabcd",
        tag: "button",
        role: "",
        name: "Sign in",
        text: "Sign in",
        selector: "#sign-in",
        ref_id: "element_0123456789abcdefabcd",
        locator: "#sign-in",
        context: "document" as const,
        inputType: null,
        href: null,
        disabled: false,
        checked: null,
        x: 120,
        y: 80,
        centerX: 170,
        centerY: 96,
        width: 100,
        height: 32
      }],
      truncated: false
    })),
    waitFor: vi.fn(async (
      _projectId: string,
      condition: "load" | "selector" | "text"
    ) => ({
      pageId: "page_1",
      url: "https://example.com/",
      condition,
      matched: true as const,
      elapsedMs: 120
    })),
    getConsole: vi.fn(async () => [{
      entryId: "console_1",
      pageId: "page_1",
      level: "error" as const,
      message: "Request failed",
      source: "https://example.com/app.js",
      line: 12,
      timestamp: "2026-08-17T06:00:00.000Z"
    }]),
    getNetwork: vi.fn<ManagedBrowserManager["getNetwork"]>(async (
      _localProjectId: string,
      _pageId?: string,
      _limit?: number
    ) => [{
      requestId: "request_1",
      pageId: "page_1",
      method: "GET",
      url: "https://example.com/api/items",
      resourceType: "xhr",
      status: 500,
      statusLine: "HTTP/1.1 500 Internal Server Error",
      mimeType: "application/json",
      requestHeaders: {
        accept: "application/json",
        authorization: "[redacted]"
      } as Record<string, string>,
      responseHeaders: { "content-type": "application/json" } as Record<string, string>,
      fromCache: false,
      failed: false,
      error: null,
      startedAt: "2026-08-17T06:00:00.000Z",
      finishedAt: "2026-08-17T06:00:00.120Z",
      durationMs: 120
    }]),
    getNetworkBody: vi.fn(async () => ({
      requestId: "request_1",
      mimeType: "application/json",
      body: '{"error":"failed"}',
      base64Encoded: false,
      truncated: false
    })),
    getPerformance: vi.fn(async () => ({
      pageId: "page_1",
      url: "https://example.com/",
      capturedAt: "2026-08-17T06:00:01.000Z",
      timeOrigin: 1_776_060_000_000,
      navigationType: "navigate",
      timings: {
        responseStartMs: 20,
        responseEndMs: 40,
        domInteractiveMs: 80,
        domContentLoadedMs: 90,
        loadEventMs: 120,
        firstPaintMs: 50,
        firstContentfulPaintMs: 60
      },
      resources: {
        count: 1,
        transferSize: 1024,
        encodedBodySize: 800,
        decodedBodySize: 1600,
        slowest: [{
          url: "https://example.com/api/items",
          initiatorType: "fetch",
          startTimeMs: 10,
          durationMs: 120,
          transferSize: 1024,
          encodedBodySize: 800,
          decodedBodySize: 1600
        }]
      }
    })),
    screenshot: vi.fn(async () => "data:image/jpeg;base64,c2NyZWVuc2hvdA==")
  };
}

function createAttachedBrowser() {
  const refId = "element_abcdef0123456789abcd";
  return {
    state: vi.fn<AttachedBrowserManager["state"]>(() => ({
      connected: true,
      endpoint: "http://127.0.0.1:9222",
      target: {
        targetId: "attached_page_1",
        title: "Signed-in page",
        url: "https://example.com/account",
        type: "page"
      },
      error: null
    })),
    navigate: vi.fn(async (url: string) => ({
      connected: true,
      endpoint: "http://127.0.0.1:9222",
      target: {
        targetId: "attached_page_1",
        title: "Signed-in page",
        url,
        type: "page"
      },
      error: null
    })),
    inspect: vi.fn(async () => ({
      pageId: "attached_page_1",
      url: "https://example.com/account",
      title: "Signed-in page",
      text: "Account Submit",
      elements: [{
        index: 0,
        refId,
        tag: "button",
        role: "button",
        name: "Submit",
        text: "Submit",
        selector: "#submit",
        locator: "#shell::shadow >>> #submit",
        context: "shadow" as const,
        inputType: null,
        href: null,
        disabled: false,
        checked: null,
        x: 70,
        y: 64,
        centerX: 120,
        centerY: 80,
        width: 100,
        height: 32
      }],
      truncated: false
    })),
    clickRef: vi.fn(async () => ({
      completed: true as const,
      pageId: "attached_page_1",
      refId,
      urlBefore: "https://example.com/account",
      urlAfter: "https://example.com/account",
      navigated: false,
      target: { tag: "button", role: "button", name: "Submit", inputType: null, x: 120, y: 80 }
    })),
    typeRef: vi.fn(async () => ({
      completed: true as const,
      pageId: "attached_page_1",
      refId,
      urlBefore: "https://example.com/account",
      urlAfter: "https://example.com/account",
      navigated: false,
      target: { tag: "input", role: "textbox", name: "Email", inputType: "email", x: 120, y: 120 }
    })),
    getConsole: vi.fn(() => [{
      entryId: "console_attached_1",
      pageId: "attached_page_1",
      level: "error" as const,
      message: "Attached error",
      source: "https://example.com/app.js",
      line: 4,
      timestamp: "2026-08-17T07:00:00.000Z"
    }]),
    getNetwork: vi.fn(() => [{
      requestId: "attached_request_1",
      pageId: "attached_page_1",
      method: "GET",
      url: "https://example.com/api",
      resourceType: "Fetch",
      status: 401,
      statusLine: "Unauthorized",
      mimeType: "application/json",
      requestHeaders: { authorization: "[redacted]" },
      responseHeaders: { "content-type": "application/json" },
      fromCache: false,
      failed: false,
      error: null,
      startedAt: "2026-08-17T07:00:00.000Z",
      finishedAt: "2026-08-17T07:00:00.100Z",
      durationMs: 100
    }]),
    getNetworkBody: vi.fn(async () => ({
      requestId: "attached_request_1",
      mimeType: "application/json",
      body: '{"error":"unauthorized"}',
      base64Encoded: false,
      truncated: false
    })),
    screenshot: vi.fn(async () => "data:image/jpeg;base64,YXR0YWNoZWQ=")
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
  it("exposes browser DOM, coordinate, console, network and screenshot Tools", async () => {
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      getBrowser: () => createBrowser()
    });

    const names = (await runner.listTools("project_1")).map((tool) => tool.function.name);

    expect(names).toEqual(expect.arrayContaining([
      "browser_inspect",
      "browser_request_user_login",
      "browser_click_ref",
      "browser_click_at",
      "browser_scroll",
      "browser_press",
      "browser_type_ref",
      "browser_wait_for",
      "browser_get_console",
      "browser_get_network",
      "browser_get_network_body",
      "browser_get_performance",
      "browser_get_diagnostics",
      "browser_export_har",
      "browser_screenshot"
    ]));
  });

  it("hands the Managed Browser to the user for secure login", async () => {
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_login",
      name: "browser_request_user_login",
      arguments: '{"page_id":"page_1"}'
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual(expect.objectContaining({
      requires_user_action: true,
      action: "sign_in_in_managed_browser",
      page_id: "page_1",
      user_takeover: true
    }));
    expect(result.content).not.toMatch(/password\s*[:=]/i);
    expect(browser.selectPage).toHaveBeenCalledWith("project_1", "page_1");
    expect(browser.setUserTakeover).toHaveBeenCalledWith(
      "project_1",
      true,
      "page_1",
      { source: "chat" }
    );
  });

  it("exposes and runs Attached Browser Tools only for an existing user connection", async () => {
    const confirm = vi.fn(async () => true);
    const attached = createAttachedBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => createBrowser(),
      getAttachedBrowser: () => attached
    });
    const names = (await runner.listTools("project_1")).map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining([
      "browser_attached_navigate",
      "browser_attached_inspect",
      "browser_attached_click_ref",
      "browser_attached_type_ref",
      "browser_attached_get_console",
      "browser_attached_get_network",
      "browser_attached_get_network_body",
      "browser_attached_screenshot"
    ]));

    const inspected = await runner.execute("project_1", {
      id: "call_attached_inspect",
      name: "browser_attached_inspect",
      arguments: '{"max_elements":50}'
    });
    const refId = JSON.parse(inspected.content).elements[0].ref_id as string;
    const clicked = await runner.execute("project_1", {
      id: "call_attached_click",
      name: "browser_attached_click_ref",
      arguments: JSON.stringify({ ref_id: refId })
    });
    const typed = await runner.execute("project_1", {
      id: "call_attached_type",
      name: "browser_attached_type_ref",
      arguments: JSON.stringify({ ref_id: refId, text: "private attached input" })
    });
    const network = await runner.execute("project_1", {
      id: "call_attached_network",
      name: "browser_attached_get_network",
      arguments: '{"limit":20}'
    });
    const body = await runner.execute("project_1", {
      id: "call_attached_body",
      name: "browser_attached_get_network_body",
      arguments: '{"request_id":"attached_request_1","max_characters":5000}'
    });
    const screenshot = await runner.execute("project_1", {
      id: "call_attached_screenshot",
      name: "browser_attached_screenshot",
      arguments: "{}"
    });

    expect(JSON.parse(inspected.content)).toMatchObject({
      page_id: "attached_page_1",
      elements: [{ ref_id: refId, context: "shadow" }]
    });
    expect(JSON.parse(clicked.content)).toMatchObject({ completed: true, ref_id: refId });
    expect(typed.content).not.toContain("private attached input");
    expect(JSON.parse(network.content)).toMatchObject({
      entries: [{ request_id: "attached_request_1", status: 401 }]
    });
    expect(JSON.parse(body.content)).toMatchObject({
      request_id: "attached_request_1",
      body: '{"error":"unauthorized"}'
    });
    expect(screenshot.images).toEqual(["data:image/jpeg;base64,YXR0YWNoZWQ="]);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.browser.read",
      risk: "R3"
    }));

    attached.state.mockReturnValue({
      connected: false,
      endpoint: null,
      target: null,
      error: null
    });
    expect((await runner.listTools("project_1")).map((tool) => tool.function.name))
      .not.toContain("browser_attached_inspect");
  });

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

  it("inspects DOM and performs a coordinate click through the browser Tool boundary", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const inspected = await runner.execute("project_1", {
      id: "call_browser_inspect",
      name: "browser_inspect",
      arguments: '{"page_id":"page_1","max_elements":50}'
    });
    const clicked = await runner.execute("project_1", {
      id: "call_browser_click_at",
      name: "browser_click_at",
      arguments: '{"page_id":"page_1","x":170,"y":96}'
    });

    expect(inspected.isError).toBe(false);
    expect(JSON.parse(inspected.content)).toMatchObject({
      page_id: "page_1",
      text: "Example Sign in",
      elements: [{
        selector: "#sign-in",
        locator: "#sign-in",
        context: "document",
        name: "Sign in",
        x: 120,
        y: 80,
        center_x: 170,
        center_y: 96
      }]
    });
    expect(browser.inspect).toHaveBeenCalledWith("project_1", "page_1", 50);
    expect(clicked.isError).toBe(false);
    expect(browser.clickPoint).toHaveBeenCalledWith(
      "project_1",
      170,
      96,
      "page_1",
      { source: "chat" }
    );
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ capability: "local.browser.read", risk: "R1" })
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ capability: "local.browser.click", risk: "R2" })
    );
  });

  it("clicks and types through inspected element references without returning typed text", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });
    const refId = "element_0123456789abcdefabcd";

    const clicked = await runner.execute("project_1", {
      id: "call_browser_click_ref",
      name: "browser_click_ref",
      arguments: JSON.stringify({ page_id: "page_1", ref_id: refId })
    });
    const typed = await runner.execute("project_1", {
      id: "call_browser_type_ref",
      name: "browser_type_ref",
      arguments: JSON.stringify({ page_id: "page_1", ref_id: refId, text: "private value" })
    });

    expect(JSON.parse(clicked.content)).toMatchObject({
      completed: true,
      ref_id: refId,
      navigated: false,
      target: { tag: "button", x: 170, y: 96 }
    });
    expect(JSON.parse(typed.content)).toMatchObject({
      completed: true,
      ref_id: refId,
      target: { tag: "input", input_type: "email" }
    });
    expect(typed.content).not.toContain("private value");
    expect(browser.clickRef).toHaveBeenCalledWith(
      "project_1", refId, "page_1", { source: "chat" }
    );
    expect(browser.typeRef).toHaveBeenCalledWith(
      "project_1", refId, "private value", "page_1", { source: "chat" }
    );
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ capability: "local.browser.click", risk: "R2" })
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ capability: "local.browser.type", risk: "R2" })
    );
  });

  it("scrolls, presses keys and waits for page conditions through browser Tools", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const scrolled = await runner.execute("project_1", {
      id: "call_browser_scroll",
      name: "browser_scroll",
      arguments: '{"page_id":"page_1","delta_y":640}'
    });
    const pressed = await runner.execute("project_1", {
      id: "call_browser_press",
      name: "browser_press",
      arguments: '{"page_id":"page_1","key":"Enter","modifiers":["control"]}'
    });
    const waited = await runner.execute("project_1", {
      id: "call_browser_wait",
      name: "browser_wait_for",
      arguments: '{"page_id":"page_1","condition":"selector","value":"#ready","timeout_ms":5000}'
    });

    expect(scrolled.isError).toBe(false);
    expect(pressed.isError).toBe(false);
    expect(JSON.parse(waited.content)).toMatchObject({
      condition: "selector",
      matched: true,
      elapsed_ms: 120
    });
    expect(browser.scroll).toHaveBeenCalledWith(
      "project_1", 0, 640, "page_1", { source: "chat" }
    );
    expect(browser.press).toHaveBeenCalledWith(
      "project_1", "Enter", ["control"], "page_1", { source: "chat" }
    );
    expect(browser.waitFor).toHaveBeenCalledWith(
      "project_1", "selector", "#ready", 5000, "page_1"
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("returns bounded console, network and screenshot observations to the model", async () => {
    const browser = createBrowser();
    const runner = new ProjectChatToolRunner({
      workerClient: createWorker(),
      toolBroker: new LocalToolBroker(async () => true),
      getBrowser: () => browser
    });

    const consoleResult = await runner.execute("project_1", {
      id: "call_browser_console",
      name: "browser_get_console",
      arguments: '{"page_id":"page_1","limit":20}'
    });
    const networkResult = await runner.execute("project_1", {
      id: "call_browser_network",
      name: "browser_get_network",
      arguments: '{"page_id":"page_1","limit":20}'
    });
    const screenshotResult = await runner.execute("project_1", {
      id: "call_browser_screenshot",
      name: "browser_screenshot",
      arguments: '{"page_id":"page_1"}'
    });
    const bodyResult = await runner.execute("project_1", {
      id: "call_browser_network_body",
      name: "browser_get_network_body",
      arguments: '{"page_id":"page_1","request_id":"request_1","max_characters":5000}'
    });
    const performanceResult = await runner.execute("project_1", {
      id: "call_browser_performance",
      name: "browser_get_performance",
      arguments: '{"page_id":"page_1"}'
    });
    const diagnosticsResult = await runner.execute("project_1", {
      id: "call_browser_diagnostics",
      name: "browser_get_diagnostics",
      arguments: '{"page_id":"page_1"}'
    });

    expect(JSON.parse(consoleResult.content)).toMatchObject({
      entries: [{ level: "error", message: "Request failed", line: 12 }]
    });
    expect(JSON.parse(networkResult.content)).toMatchObject({
      entries: [{
        method: "GET",
        status: 500,
        duration_ms: 120,
        request_headers: { accept: "application/json", authorization: "[redacted]" },
        response_headers: { "content-type": "application/json" }
      }]
    });
    expect(JSON.parse(screenshotResult.content)).toMatchObject({
      page_id: "page_1",
      image_attached: true
    });
    expect(screenshotResult.images).toEqual([
      "data:image/jpeg;base64,c2NyZWVuc2hvdA=="
    ]);
    expect(JSON.parse(bodyResult.content)).toMatchObject({
      request_id: "request_1",
      mime_type: "application/json",
      body: '{"error":"failed"}',
      base64_encoded: false,
      truncated: false
    });
    expect(JSON.parse(performanceResult.content)).toMatchObject({
      page_id: "page_1",
      navigation_type: "navigate",
      timings: { first_contentful_paint_ms: 60 },
      resources: { count: 1, transfer_size: 1024 }
    });
    expect(JSON.parse(diagnosticsResult.content)).toMatchObject({
      summary: {
        console_problems: 1,
        network_problems: 1
      },
      console_problems: [{ level: "error", message: "Request failed" }],
      network_problems: [{ request_id: "request_1", status: 500 }]
    });
    expect(browser.getConsole).toHaveBeenCalledWith("project_1", "page_1", 20);
    expect(browser.getNetwork).toHaveBeenCalledWith("project_1", "page_1", 20);
    expect(browser.screenshot).toHaveBeenCalledWith(
      "project_1",
      "page_1",
      { source: "chat" },
      "agent"
    );
    expect(browser.getNetworkBody).toHaveBeenCalledWith(
      "project_1",
      "request_1",
      "page_1",
      5000
    );
    expect(browser.getPerformance).toHaveBeenCalledWith("project_1", "page_1");
  });

  it("exports redacted network metadata as a body-free and cookie-free HAR artifact", async () => {
    const confirm = vi.fn(async () => true);
    const browser = createBrowser();
    browser.getNetwork.mockResolvedValue([{
      ...(await browser.getNetwork("project_1", "page_1", 300))[0]!,
      url: "https://example.com/api/items?token=%5Bredacted%5D&q=visible",
      requestHeaders: {
        accept: "application/json",
        authorization: "[redacted]",
        cookie: "[redacted]"
      } as Record<string, string>,
      responseHeaders: {
        "content-type": "application/json",
        location: "https://example.com/login?code=%5Bredacted%5D"
      } as Record<string, string>
    }]);
    const worker = createWorker();
    worker.createProjectFile.mockImplementation(async (_projectId, path, text) => ({
      uri: `routemarket-work://project/project_1/${path}`,
      text,
      bytesRead: text.length,
      truncated: false,
      encoding: "utf8" as const,
      sha256: "c".repeat(64),
      created: true as const
    }));
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm),
      getBrowser: () => browser
    });

    const result = await runner.execute("project_1", {
      id: "call_browser_har",
      name: "browser_export_har",
      arguments: '{"path":"artifacts/network.har","page_id":"page_1"}'
    });

    expect(result.isError).toBe(false);
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        relativePath: "artifacts/network.har",
        providerId: "ai.routemarket.browser-har"
      })
    ]);
    const har = JSON.parse(String(worker.createProjectFile.mock.calls[0]?.[2])) as {
      log: { entries: Array<Record<string, unknown>> };
    };
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0]).toMatchObject({
      request: {
        url: "https://example.com/api/items?token=%5Bredacted%5D&q=visible",
        cookies: [],
        bodySize: -1
      },
      response: {
        cookies: [],
        content: { size: -1, mimeType: "application/json" },
        redirectURL: "https://example.com/login?code=%5Bredacted%5D"
      }
    });
    expect(JSON.stringify(har)).not.toContain('{"error":"failed"}');
    expect(JSON.stringify(har)).not.toContain('"name":"cookie"');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      capability: "local.fs.create",
      risk: "R2"
    }));
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
