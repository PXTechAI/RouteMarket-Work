import { createHash } from "node:crypto";
import type {
  ManagedProcessSummary,
  ManagedBrowserState,
  ProjectFileEntry,
  ProjectSearchMatch,
  ReadResult
} from "../shared/desktop-api";
import type { ManagedBrowserManager } from "./managed-browser-manager";
import { ProjectChatMcpToolRuntime } from "./project-chat-mcp-tools";
import { ProjectChatSkillRuntime } from "./project-chat-skill-tools";
import type { LocalToolBroker } from "./tool-broker";
import type { WorkerClient } from "./worker-client";
import type {
  ProjectChatToolCall,
  ProjectChatToolDefinition,
  ProjectChatToolExecution
} from "./project-chat-tools";
import { PROJECT_CHAT_TOOLS } from "./project-chat-tools";

const MAX_PATH_LENGTH = 1_024;
const MAX_WRITE_CHARACTERS = 1_000_000;
const MAX_TOOL_TEXT_CHARACTERS = 160_000;
const MAX_LISTED_PATHS = 500;
const MAX_PROCESS_ARGUMENTS = 128;
const MAX_PROCESS_ARGUMENT_LENGTH = 8_192;
const MAX_PROCESS_WAIT_MS = 15_000;
const DEFAULT_PROCESS_WAIT_MS = 1_000;
const PROCESS_POLL_INTERVAL_MS = 100;
const MAX_BROWSER_URL_LENGTH = 8_192;
const MAX_BROWSER_SELECTOR_LENGTH = 2_048;
const MAX_BROWSER_TEXT_LENGTH = 100_000;
const MAX_BROWSER_ID_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

type ProjectChatBrowser = Pick<
  ManagedBrowserManager,
  | "getState"
  | "getPageState"
  | "createPage"
  | "selectPage"
  | "setUserTakeover"
  | "navigate"
  | "click"
  | "type"
  | "extract"
>;

type ProjectChatToolRunnerOptions = {
  workerClient: Pick<
    WorkerClient,
    | "listProjectFiles"
    | "searchProject"
    | "readProjectFile"
    | "writeProjectFile"
    | "createProjectFile"
    | "startProcess"
    | "listProcesses"
    | "stopProcess"
  >;
  toolBroker: LocalToolBroker;
  getBrowser?: () => ProjectChatBrowser;
  mcpClient?: Pick<
    WorkerClient,
    "listMcpServers" | "startMcpServer" | "callMcpTool"
  >;
  skillClient?: Pick<WorkerClient, "projectContext" | "readProjectFile">;
  onActivity?: (
    type: "job.started" | "job.succeeded" | "job.failed",
    title: string,
    detail: string
  ) => void;
};

export class ProjectChatToolRunner {
  private readonly mcpRuntime: ProjectChatMcpToolRuntime | null;
  private readonly skillRuntime: ProjectChatSkillRuntime | null;

  constructor(private readonly options: ProjectChatToolRunnerOptions) {
    this.mcpRuntime = options.mcpClient
      ? new ProjectChatMcpToolRuntime({
          client: options.mcpClient,
          toolBroker: options.toolBroker,
          onActivity: options.onActivity
        })
      : null;
    this.skillRuntime = options.skillClient
      ? new ProjectChatSkillRuntime({
          client: options.skillClient,
          onActivity: options.onActivity
        })
      : null;
  }

  async listTools(localProjectId: string): Promise<ProjectChatToolDefinition[]> {
    const tools = [...PROJECT_CHAT_TOOLS];
    if (this.skillRuntime) {
      try {
        tools.push(...await this.skillRuntime.listDefinitions(localProjectId));
      } catch (error) {
        this.options.onActivity?.(
          "job.failed",
          "项目 Skills 暂不可用",
          error instanceof Error ? error.message : "无法读取项目 Skill 列表"
        );
      }
    }
    if (this.mcpRuntime) {
      try {
        tools.push(...await this.mcpRuntime.listDefinitions(localProjectId));
      } catch (error) {
        this.options.onActivity?.(
          "job.failed",
          "Local MCP Tools 暂不可用",
          error instanceof Error ? error.message : "无法读取 Local MCP Tool 列表"
        );
      }
    }
    return tools;
  }

  async execute(
    localProjectId: string,
    call: ProjectChatToolCall,
    signal?: AbortSignal
  ): Promise<ProjectChatToolExecution> {
    if (this.mcpRuntime?.isDynamicToolName(call.name)) {
      return this.mcpRuntime.execute(localProjectId, call, signal);
    }
    if (this.skillRuntime?.isDynamicToolName(call.name)) {
      return this.skillRuntime.execute(localProjectId, call, signal);
    }
    try {
      throwIfAborted(signal);
      const args = parseArguments(call.arguments);
      if (call.name === "project_list_files") {
        assertNoUnexpectedKeys(args, []);
        return await this.runRead(
          localProjectId,
          "查看项目文件",
          "项目文件树",
          async () => {
            const result = await this.options.workerClient.listProjectFiles(localProjectId);
            const paths = flattenEntries(result.entries).slice(0, MAX_LISTED_PATHS);
            return {
              content: stringifyToolResult({
                paths,
                total_entries: result.totalEntries,
                truncated: result.truncated || paths.length >= MAX_LISTED_PATHS
              }),
              summary: `${paths.length} 个路径`
            };
          }
        );
      }

      if (call.name === "project_search") {
        assertNoUnexpectedKeys(args, ["query"]);
        const query = requiredString(args, "query", 256);
        return await this.runRead(
          localProjectId,
          "搜索项目",
          query,
          async () => {
            const result = await this.options.workerClient.searchProject(
              localProjectId,
              query
            );
            return {
              content: stringifyToolResult({
                query: result.query,
                matches: result.matches.map(sanitizeSearchMatch),
                files_scanned: result.filesScanned,
                truncated: result.truncated
              }),
              summary: `${result.matches.length} 个结果`
            };
          }
        );
      }

      if (call.name === "project_read_file") {
        assertNoUnexpectedKeys(args, ["path"]);
        const path = requiredPath(args);
        return await this.runRead(
          localProjectId,
          "读取项目文件",
          path,
          async () => {
            const result = await this.options.workerClient.readProjectFile(
              localProjectId,
              path
            );
            return {
              content: stringifyToolResult(sanitizeReadResult(path, result)),
              summary: `${path} · ${result.bytesRead} bytes`
            };
          }
        );
      }

      if (call.name === "project_write_file") {
        assertNoUnexpectedKeys(args, ["path", "text", "expected_sha256"]);
        const path = requiredPath(args);
        const text = requiredText(args);
        const expectedSha256 = requiredString(args, "expected_sha256", 64);
        if (!SHA256_PATTERN.test(expectedSha256)) {
          throw new Error("expected_sha256 must be a 64-character SHA-256 hash.");
        }
        return await this.runMutation(
          localProjectId,
          {
            capability: "local.fs.write",
            title: `允许 AI 修改 ${path}？`,
            detail: path,
            approvalKey: `${expectedSha256}:${sha256(text)}`
          },
          "修改项目文件",
          path,
          async () => {
            const result = await this.options.workerClient.writeProjectFile(
              localProjectId,
              path,
              text,
              expectedSha256
            );
            return {
              content: stringifyToolResult({
                path,
                changed: result.changed,
                bytes_read: result.bytesRead,
                sha256: result.sha256,
                previous_sha256: result.previousSha256
              }),
              summary: result.changed ? `已修改 ${path}` : `${path} 没有变化`
            };
          }
        );
      }

      if (call.name === "project_create_file") {
        assertNoUnexpectedKeys(args, ["path", "text"]);
        const path = requiredPath(args);
        const text = requiredText(args);
        return await this.runMutation(
          localProjectId,
          {
            capability: "local.fs.create",
            title: `允许 AI 新建 ${path}？`,
            detail: path,
            approvalKey: `${path}:${sha256(text)}`
          },
          "新建项目文件",
          path,
          async () => {
            const result = await this.options.workerClient.createProjectFile(
              localProjectId,
              path,
              text
            );
            return {
              content: stringifyToolResult({
                path,
                created: true,
                bytes_read: result.bytesRead,
                sha256: result.sha256
              }),
              summary: `已创建 ${path}`
            };
          }
        );
      }

      if (call.name === "project_start_process") {
        assertNoUnexpectedKeys(args, ["executable", "args", "wait_ms"]);
        const executable = requiredString(args, "executable", MAX_PATH_LENGTH);
        const processArgs = requiredStringArray(
          args,
          "args",
          MAX_PROCESS_ARGUMENTS,
          MAX_PROCESS_ARGUMENT_LENGTH
        );
        const waitMs = optionalInteger(
          args,
          "wait_ms",
          0,
          MAX_PROCESS_WAIT_MS,
          DEFAULT_PROCESS_WAIT_MS
        );
        const command = formatCommand(executable, processArgs);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.process.start",
            risk: "R2",
            title: `允许 AI 在项目中启动 ${executable}？`,
            detail: clipDetail(command),
            auditDetail: executable,
            approvalKey: sha256(JSON.stringify([executable, ...processArgs]))
          },
          "启动项目进程",
          clipDetail(command),
          async () => {
            throwIfAborted(signal);
            const started = await this.options.workerClient.startProcess(
              localProjectId,
              executable,
              processArgs
            );
            const result = waitMs > 0
              ? await this.waitForProcess(
                  localProjectId,
                  started.processId,
                  waitMs,
                  signal
                )
              : started;
            return {
              content: stringifyToolResult(sanitizeProcess(result)),
              summary: processSummary(result)
            };
          }
        );
      }

      if (call.name === "project_list_processes") {
        assertNoUnexpectedKeys(args, []);
        return await this.runWithActivity(
          "查看项目进程",
          localProjectId,
          async () => {
            const processes = (await this.options.workerClient.listProcesses())
              .filter((process) => process.localProjectId === localProjectId)
              .map(sanitizeProcess);
            return {
              content: stringifyToolResult({ processes }),
              summary: `${processes.length} 个项目进程`
            };
          }
        );
      }

      if (call.name === "project_stop_process") {
        assertNoUnexpectedKeys(args, ["process_id"]);
        const processId = requiredString(args, "process_id", 128);
        const process = await this.findProjectProcess(localProjectId, processId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.process.stop",
            risk: "R2",
            title: `允许 AI 停止 ${process.executable}？`,
            detail: processId,
            auditDetail: process.executable,
            approvalKey: processId
          },
          "停止项目进程",
          processId,
          async () => {
            const result = await this.options.workerClient.stopProcess(processId);
            return {
              content: stringifyToolResult(sanitizeProcess(result)),
              summary: `已停止 ${result.executable} · ${result.processId}`
            };
          }
        );
      }

      if (call.name === "browser_get_state") {
        assertNoUnexpectedKeys(args, []);
        return await this.runWithActivity(
          "查看浏览器页面",
          localProjectId,
          async () => {
            const state = await this.requireBrowser().getState(localProjectId);
            return {
              content: stringifyToolResult(sanitizeBrowserState(state)),
              summary: `${state.pages.length} 个浏览器页面`
            };
          }
        );
      }

      if (call.name === "browser_create_page") {
        assertNoUnexpectedKeys(args, ["url", "profile_id"]);
        const url = optionalString(args, "url", MAX_BROWSER_URL_LENGTH);
        const profileId = optionalString(args, "profile_id", MAX_BROWSER_ID_LENGTH);
        const detail = url ?? "about:blank";
        const browser = this.requireBrowser();
        if (profileId) {
          const state = await browser.getState(localProjectId);
          if (!state.profiles.some((profile) => profile.profileId === profileId)) {
            const error = new Error("Browser Profile not found in the current project.");
            Object.assign(error, { code: "BROWSER_PROFILE_NOT_FOUND" });
            throw error;
          }
        }
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.navigate",
            risk: "R1",
            title: "允许 AI 新建浏览器页面？",
            detail,
            auditDetail: "Managed Browser",
            approvalKey: `${profileId ?? "default"}:${detail}`
          },
          "新建浏览器页面",
          detail,
          async () => {
            throwIfAborted(signal);
            const created = await browser.createPage(
              localProjectId,
              profileId,
              url ?? "about:blank"
            );
            const state = await browser.setUserTakeover(
              localProjectId,
              false,
              created.activePageId
            );
            return {
              content: stringifyToolResult(sanitizeBrowserState(state)),
              summary: browserPageSummary(state)
            };
          }
        );
      }

      if (call.name === "browser_navigate") {
        assertNoUnexpectedKeys(args, ["url", "page_id"]);
        const url = requiredString(args, "url", MAX_BROWSER_URL_LENGTH);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.navigate",
            risk: "R1",
            title: "允许 AI 打开网页？",
            detail: clipDetail(url),
            auditDetail: "Managed Browser",
            approvalKey: `${pageId ?? "active"}:${url}`
          },
          "打开网页",
          clipDetail(url),
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const state = await browser.navigate(localProjectId, url, pageId);
            return {
              content: stringifyToolResult(sanitizeBrowserState(state)),
              summary: browserPageSummary(state)
            };
          }
        );
      }

      if (call.name === "browser_click") {
        assertNoUnexpectedKeys(args, ["selector", "page_id"]);
        const selector = requiredString(args, "selector", MAX_BROWSER_SELECTOR_LENGTH);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.click",
            risk: "R2",
            title: "允许 AI 点击网页元素？",
            detail: clipDetail(selector),
            auditDetail: "Managed Browser DOM selector",
            approvalKey: `${pageId ?? "active"}:${selector}`
          },
          "点击网页元素",
          clipDetail(selector),
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(
              browser,
              localProjectId,
              pageId
            );
            await browser.click(localProjectId, selector, pageId);
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: before.activePageId,
                url: before.url
              }),
              summary: `已点击 ${selector}`
            };
          }
        );
      }

      if (call.name === "browser_type") {
        assertNoUnexpectedKeys(args, ["selector", "text", "page_id"]);
        const selector = requiredString(args, "selector", MAX_BROWSER_SELECTOR_LENGTH);
        const text = requiredBrowserText(args);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.type",
            risk: "R2",
            title: "允许 AI 填写网页内容？",
            detail: clipDetail(selector),
            auditDetail: "Managed Browser DOM input",
            approvalKey: `${pageId ?? "active"}:${selector}:${sha256(text)}`
          },
          "填写网页内容",
          clipDetail(selector),
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(
              browser,
              localProjectId,
              pageId
            );
            await browser.type(localProjectId, selector, text, pageId);
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: before.activePageId,
                url: before.url,
                characters: text.length
              }),
              summary: `已填写 ${text.length} 个字符`
            };
          }
        );
      }

      if (call.name === "browser_extract") {
        assertNoUnexpectedKeys(args, ["selector", "page_id"]);
        const selector = requiredString(args, "selector", MAX_BROWSER_SELECTOR_LENGTH);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.extract",
            risk: "R1",
            title: "允许 AI 读取网页内容？",
            detail: clipDetail(selector),
            auditDetail: "Managed Browser DOM selector",
            approvalKey: `${pageId ?? "active"}:${selector}`
          },
          "读取网页内容",
          clipDetail(selector),
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(
              browser,
              localProjectId,
              pageId
            );
            const extracted = clipText(
              await browser.extract(localProjectId, selector, pageId)
            );
            return {
              content: stringifyToolResult({
                page_id: before.activePageId,
                url: before.url,
                selector,
                text: extracted.text,
                truncated: extracted.truncated
              }),
              summary: `读取 ${extracted.text.length} 个字符`
            };
          }
        );
      }

      throw new Error(`Unsupported local tool: ${call.name}`);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        content: stringifyToolResult({
          error: {
            code: readErrorCode(error),
            message: error instanceof Error ? error.message : "Unknown local tool error"
          }
        }),
        summary: error instanceof Error ? error.message : "本地工具执行失败",
        isError: true
      };
    }
  }

  private async runRead(
    localProjectId: string,
    title: string,
    detail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
  ): Promise<ProjectChatToolExecution> {
    return this.runWithActivity(title, detail, () =>
      this.options.toolBroker.run(
        {
          capability: "local.fs.read",
          risk: "R0",
          title,
          detail,
          projectId: localProjectId
        },
        operation
      )
    );
  }

  private async runMutation(
    localProjectId: string,
    authorization: {
      capability: string;
      title: string;
      detail: string;
      approvalKey: string;
    },
    activityTitle: string,
    activityDetail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
  ): Promise<ProjectChatToolExecution> {
    return this.runAuthorized(
      localProjectId,
      { ...authorization, risk: "R1" },
      activityTitle,
      activityDetail,
      operation
    );
  }

  private async runAuthorized(
    localProjectId: string,
    authorization: {
      capability: string;
      risk: "R1" | "R2" | "R3";
      title: string;
      detail: string;
      auditDetail?: string;
      approvalKey: string;
    },
    activityTitle: string,
    activityDetail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
  ): Promise<ProjectChatToolExecution> {
    return this.runWithActivity(activityTitle, activityDetail, () =>
      this.options.toolBroker.run(
        {
          ...authorization,
          projectId: localProjectId
        },
        operation
      )
    );
  }

  private async findProjectProcess(
    localProjectId: string,
    processId: string
  ): Promise<ManagedProcessSummary> {
    const process = (await this.options.workerClient.listProcesses()).find(
      (item) => item.processId === processId
    );
    if (!process || process.localProjectId !== localProjectId) {
      const error = new Error("The managed process was not found in the current project.");
      Object.assign(error, { code: "PROCESS_NOT_FOUND" });
      throw error;
    }
    return process;
  }

  private requireBrowser(): ProjectChatBrowser {
    if (!this.options.getBrowser) {
      const error = new Error("Managed Browser is unavailable.");
      Object.assign(error, { code: "BROWSER_UNAVAILABLE" });
      throw error;
    }
    return this.options.getBrowser();
  }

  private async assertAgentBrowserControl(
    browser: ProjectChatBrowser,
    localProjectId: string,
    pageId?: string
  ): Promise<ManagedBrowserState> {
    const state = await browser.getPageState(localProjectId, pageId);
    if (state.userTakeover) {
      const error = new Error(
        "This Browser page is under user takeover. Switch it to Agent control or create a new Browser page."
      );
      Object.assign(error, { code: "BROWSER_USER_TAKEOVER" });
      throw error;
    }
    return state;
  }

  private async activateAgentBrowserPage(
    browser: ProjectChatBrowser,
    localProjectId: string,
    pageId?: string
  ): Promise<ManagedBrowserState> {
    if (pageId) await browser.selectPage(localProjectId, pageId);
    return this.assertAgentBrowserControl(browser, localProjectId, pageId);
  }

  private async waitForProcess(
    localProjectId: string,
    processId: string,
    waitMs: number,
    signal?: AbortSignal
  ): Promise<ManagedProcessSummary> {
    const deadline = Date.now() + waitMs;
    let process = await this.findProjectProcess(localProjectId, processId);
    while (process.status === "running" && Date.now() < deadline) {
      await delay(
        Math.min(PROCESS_POLL_INTERVAL_MS, deadline - Date.now()),
        signal
      );
      process = await this.findProjectProcess(localProjectId, processId);
    }
    return process;
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
        error instanceof Error ? error.message : "Unknown local tool error"
      );
      throw error;
    }
  }
}

function parseArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function assertNoUnexpectedKeys(
  args: Record<string, unknown>,
  allowed: string[]
): void {
  const unexpected = Object.keys(args).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`Unexpected tool argument: ${unexpected}`);
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
  maxLength: number
): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${key} must contain between 1 and ${maxLength} characters.`);
  }
  if (value.includes("\0")) throw new Error(`${key} contains an invalid null byte.`);
  return value;
}

function requiredPath(args: Record<string, unknown>): string {
  return requiredString(args, "path", MAX_PATH_LENGTH).replaceAll("\\", "/");
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
  maxLength: number
): string | undefined {
  if (args[key] === undefined) return undefined;
  return requiredString(args, key, maxLength);
}

function requiredBrowserText(args: Record<string, unknown>): string {
  const text = args.text;
  if (
    typeof text !== "string" ||
    text.length > MAX_BROWSER_TEXT_LENGTH ||
    text.includes("\0")
  ) {
    throw new Error(
      `text must be a string no longer than ${MAX_BROWSER_TEXT_LENGTH} characters.`
    );
  }
  return text;
}

function requiredText(args: Record<string, unknown>): string {
  const text = args.text;
  if (typeof text !== "string" || text.length > MAX_WRITE_CHARACTERS) {
    throw new Error(
      `text must be a string no longer than ${MAX_WRITE_CHARACTERS} characters.`
    );
  }
  return text;
}

function requiredStringArray(
  args: Record<string, unknown>,
  key: string,
  maxItems: number,
  maxItemLength: number
): string[] {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.length > maxItemLength ||
        item.includes("\0")
    )
  ) {
    throw new Error(
      `${key} must be an array of at most ${maxItems} strings no longer than ${maxItemLength} characters.`
    );
  }
  return value;
}

function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function flattenEntries(
  entries: ProjectFileEntry[],
  output: Array<{ path: string; kind: "file" | "directory" }> = []
): Array<{ path: string; kind: "file" | "directory" }> {
  for (const entry of entries) {
    output.push({ path: entry.relativePath, kind: entry.kind });
    if (output.length >= MAX_LISTED_PATHS) return output;
    if (entry.children?.length) flattenEntries(entry.children, output);
    if (output.length >= MAX_LISTED_PATHS) return output;
  }
  return output;
}

function sanitizeSearchMatch(match: ProjectSearchMatch) {
  return {
    path: match.relativePath,
    match_kind: match.matchKind,
    line: match.line,
    column: match.column,
    preview: match.preview
  };
}

function sanitizeReadResult(path: string, result: ReadResult) {
  const clipped = clipText(result.text);
  return {
    path,
    text: clipped.text,
    bytes_read: result.bytesRead,
    truncated: result.truncated || clipped.truncated,
    encoding: result.encoding,
    sha256: result.sha256
  };
}

function sanitizeProcess(process: ManagedProcessSummary) {
  const stdout = clipText(process.stdout);
  const stderr = clipText(process.stderr);
  return {
    process_id: process.processId,
    executable: process.executable,
    args: process.args,
    status: process.status,
    exit_code: process.exitCode,
    signal: process.signal,
    stdout: stdout.text,
    stderr: stderr.text,
    output_truncated:
      process.outputTruncated || stdout.truncated || stderr.truncated,
    started_at: process.startedAt,
    finished_at: process.finishedAt
  };
}

function sanitizeBrowserState(state: ManagedBrowserState) {
  return {
    active_page_id: state.activePageId,
    active_profile_id: state.activeProfileId,
    url: state.url,
    title: state.title,
    loading: state.loading,
    user_takeover: state.userTakeover,
    crashed: state.crashed,
    pages: state.pages.map((page) => ({
      page_id: page.pageId,
      profile_id: page.profileId,
      title: page.title,
      url: page.url,
      loading: page.loading,
      crashed: page.crashed
    })),
    profile_ids: state.profiles.map((profile) => profile.profileId)
  };
}

function browserPageSummary(state: ManagedBrowserState): string {
  return `${state.title || state.url || "about:blank"} · ${state.activePageId}`;
}

function processSummary(process: ManagedProcessSummary): string {
  if (process.status === "running") {
    return `${process.executable} 正在运行 · ${process.processId}`;
  }
  const exit = process.exitCode === null ? process.status : `退出码 ${process.exitCode}`;
  return `${process.executable} 已结束 · ${exit}`;
}

function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args.map(formatArgument)].join(" ");
}

function formatArgument(value: string): string {
  if (!value || /\s|"/.test(value)) return JSON.stringify(value);
  return value;
}

function clipDetail(value: string): string {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
}

function clipText(text: string) {
  if (text.length <= MAX_TOOL_TEXT_CHARACTERS) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, MAX_TOOL_TEXT_CHARACTERS),
    truncated: true
  };
}

function stringifyToolResult(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "LOCAL_TOOL_ERROR";
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, milliseconds));
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error("The local Tool operation was cancelled.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
