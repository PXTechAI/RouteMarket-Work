import { trMain } from "./i18n";
import { createHash } from "node:crypto";
import type { PluginManifest } from "@routemarket/work-protocol";
import type {
  ManagedBrowserConsoleEntry,
  ManagedBrowserDomElement,
  ManagedBrowserElementActionResult,
  ManagedBrowserNetworkEntry,
  ManagedBrowserPerformance,
  ManagedProcessSummary,
  ManagedBrowserState,
  ProjectFileEntry,
  ProjectSearchMatch,
  ReadResult
} from "../shared/desktop-api";
import type { ManagedBrowserManager } from "./managed-browser-manager";
import type { AttachedBrowserManager } from "./attached-browser-manager";
import { ProjectChatMcpToolRuntime } from "./project-chat-mcp-tools";
import { ProjectChatPluginRegistry } from "./project-chat-plugin-registry";
import { ProjectChatSkillRuntime } from "./project-chat-skill-tools";
import { createSpreadsheetChatPlugin } from "./spreadsheet-chat-plugin";
import { createPdfChatPlugin } from "./pdf-chat-plugin";
import type { ProjectPdfResult } from "./project-pdf-service";
import type { LocalToolBroker, ToolApprovalMode, ToolRisk } from "./tool-broker";
import type { WorkerClient } from "./worker-client";
import type {
  ProjectChatToolCall,
  ProjectChatToolDefinition,
  ProjectChatToolExecution
} from "./project-chat-tools";
import { ATTACHED_BROWSER_CHAT_TOOLS, PROJECT_CHAT_TOOLS } from "./project-chat-tools";

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
  | "clickRef"
  | "clickPoint"
  | "scroll"
  | "press"
  | "type"
  | "typeRef"
  | "upload"
  | "extract"
  | "inspect"
  | "waitFor"
  | "getConsole"
  | "getNetwork"
  | "getNetworkBody"
  | "getPerformance"
  | "screenshot"
>;

type ProjectChatAttachedBrowser = Pick<
  AttachedBrowserManager,
  | "state"
  | "navigate"
  | "inspect"
  | "clickRef"
  | "typeRef"
  | "getConsole"
  | "getNetwork"
  | "getNetworkBody"
  | "screenshot"
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
  > & Partial<Pick<
    WorkerClient,
    | "createProjectSpreadsheet"
    | "inspectProjectSpreadsheet"
    | "readProjectSpreadsheetRange"
    | "writeProjectSpreadsheetRange"
    | "exportProjectSpreadsheetCsv"
  >>;
  toolBroker: LocalToolBroker;
  getBrowser?: () => ProjectChatBrowser;
  getAttachedBrowser?: () => ProjectChatAttachedBrowser;
  mcpClient?: Pick<
    WorkerClient,
    "listMcpServers" | "startMcpServer" | "callMcpTool"
  >;
  skillClient?: Pick<WorkerClient, "projectContext" | "invokeProjectSkill">;
  pdfClient?: {
    createProjectPdf(input: {
      localProjectId: string;
      relativePath: string;
      title?: string;
      content: string;
    }): Promise<ProjectPdfResult>;
  };
  onActivity?: (
    type: "job.started" | "job.succeeded" | "job.failed",
    title: string,
    detail: string
  ) => void;
};

export class ProjectChatToolRunner {
  private readonly mcpRuntime: ProjectChatMcpToolRuntime | null;
  private readonly pluginRegistry = new ProjectChatPluginRegistry();
  private readonly skillRuntime: ProjectChatSkillRuntime | null;
  private marketplacePluginIds = new Set<string>();

  constructor(private readonly options: ProjectChatToolRunnerOptions) {
    this.pluginRegistry.register(createSpreadsheetChatPlugin({
      workerClient: options.workerClient,
      runAuthorized: (...args) => this.runAuthorized(...args)
    }));
    if (options.pdfClient) {
      this.pluginRegistry.register(createPdfChatPlugin({
        createProjectPdf: (input) => options.pdfClient!.createProjectPdf(input),
        runAuthorized: (...args) => this.runAuthorized(...args)
      }));
    }
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

  setMarketplacePluginManifests(manifests: PluginManifest[]): void {
    for (const pluginId of this.marketplacePluginIds) this.pluginRegistry.removeByPluginId(pluginId);
    this.marketplacePluginIds = new Set();
    for (const manifest of manifests) {
      if (
        manifest.kind !== "declarative_plugin" || manifest.status !== "available" ||
        manifest.distribution.source !== "marketplace"
      ) continue;
      for (const contribution of manifest.contributes.tools) {
        if (
          contribution.status !== "available" ||
          contribution.capability !== "local.spreadsheet.write" ||
          contribution.risk !== "R2" ||
          !manifest.permissions.includes("project.read") ||
          !manifest.permissions.includes("project.write") ||
          contribution.name === "spreadsheet" ||
          this.pluginRegistry.find(contribution.name)
        ) continue;
        this.pluginRegistry.register(createSpreadsheetChatPlugin({
          workerClient: this.options.workerClient,
          runAuthorized: (...args) => this.runAuthorized(...args),
          identity: {
            pluginId: manifest.id,
            toolName: contribution.name,
            description: contribution.description
          }
        }));
        this.marketplacePluginIds.add(manifest.id);
      }
    }
  }

  async listTools(localProjectId: string): Promise<ProjectChatToolDefinition[]> {
    const tools = [...PROJECT_CHAT_TOOLS, ...this.pluginRegistry.listDefinitions()];
    if (this.options.getAttachedBrowser?.().state().connected) {
      tools.push(...ATTACHED_BROWSER_CHAT_TOOLS);
    }
    if (this.skillRuntime) {
      try {
        tools.push(...await this.skillRuntime.listDefinitions(localProjectId));
      } catch (error) {
        this.options.onActivity?.(
          "job.failed",
          trMain("ui.9919374825db"),
          error instanceof Error ? error.message : trMain("ui.f3dd08f8354c")
        );
      }
    }
    if (this.mcpRuntime) {
      try {
        tools.push(...await this.mcpRuntime.listDefinitions(localProjectId));
      } catch (error) {
        this.options.onActivity?.(
          "job.failed",
          trMain("ui.75917bd0a669"),
          error instanceof Error ? error.message : trMain("ui.0f7d86c07118")
        );
      }
    }
    return tools;
  }

  async execute(
    localProjectId: string,
    call: ProjectChatToolCall,
    signal?: AbortSignal,
    context: {
      source: "chat" | "agent";
      approvalMode?: ToolApprovalMode;
    } = { source: "chat" }
  ): Promise<ProjectChatToolExecution> {
    const approvalMode = context.approvalMode ?? "risky_only";
    if (this.mcpRuntime?.isDynamicToolName(call.name)) {
      return this.mcpRuntime.execute(localProjectId, call, signal, approvalMode);
    }
    if (this.skillRuntime?.isDynamicToolName(call.name)) {
      return this.skillRuntime.execute(localProjectId, call, signal);
    }
    try {
      throwIfAborted(signal);
      const args = parseArguments(call.arguments);
      const pluginTool = this.pluginRegistry.find(call.name);
      if (pluginTool) {
        return await pluginTool.execute({
          localProjectId,
          call,
          args,
          signal,
          approvalMode
        });
      }
      if (call.name === "project_list_files") {
        assertNoUnexpectedKeys(args, []);
        return await this.runRead(
          localProjectId,
          trMain("ui.cc7dcd4bb00a"),
          trMain("ui.90ced4b2a468"),
          async () => {
            const result = await this.options.workerClient.listProjectFiles(localProjectId);
            const paths = flattenEntries(result.entries).slice(0, MAX_LISTED_PATHS);
            return {
              content: stringifyToolResult({
                paths,
                total_entries: result.totalEntries,
                truncated: result.truncated || paths.length >= MAX_LISTED_PATHS
              }),
              summary: trMain("ui.cc5a5f079912", [paths.length])
            };
          },
          approvalMode
        );
      }

      if (call.name === "project_search") {
        assertNoUnexpectedKeys(args, ["query"]);
        const query = requiredString(args, "query", 256);
        return await this.runRead(
          localProjectId,
          trMain("ui.b617f05c84e4"),
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
              summary: trMain("ui.d8917e1f1771", [result.matches.length])
            };
          },
          approvalMode
        );
      }

      if (call.name === "project_read_file") {
        assertNoUnexpectedKeys(args, ["path"]);
        const path = requiredPath(args);
        return await this.runRead(
          localProjectId,
          trMain("ui.87e4a3b9a477"),
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
          },
          approvalMode
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
            title: trMain("ui.5e6df975d599", [path]),
            detail: path,
            approvalKey: `${expectedSha256}:${sha256(text)}`
          },
          trMain("ui.d477365c5d2b"),
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
              summary: result.changed ? trMain("ui.feff086bf00b", [path]) : trMain("ui.790807fa7319", [path])
            };
          },
          approvalMode
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
            title: trMain("ui.9eeaed8bf736", [path]),
            detail: path,
            approvalKey: `${path}:${sha256(text)}`
          },
          trMain("ui.54c7ecfd638a"),
          path,
          async () => {
            const result = await this.options.workerClient.createProjectFile(
              localProjectId,
              path,
              text
            );
            const artifact = {
              id: `artifact_${sha256(`${localProjectId}:${path}:${result.sha256}`).slice(0, 24)}`,
              kind: "file" as const,
              relativePath: path,
              filename: path.split("/").at(-1)!,
              mimeType: mimeTypeForPath(path),
              size: result.bytesRead,
              uri: result.uri,
              providerId: "ai.routemarket.project-file"
            };
            return {
              content: stringifyToolResult({
                path,
                created: true,
                bytes_read: result.bytesRead,
                sha256: result.sha256,
                output_files: [artifact]
              }),
              summary: trMain("ui.ba6e03befdaf", [path]),
              artifacts: [artifact]
            };
          },
          approvalMode
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
            title: trMain("ui.e70203761fbb", [executable]),
            detail: clipDetail(command),
            auditDetail: executable,
            approvalKey: sha256(JSON.stringify([executable, ...processArgs]))
          },
          trMain("ui.72729d85ab04"),
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
          },
          approvalMode
        );
      }

      if (call.name === "project_list_processes") {
        assertNoUnexpectedKeys(args, []);
        return await this.runPassive(
          localProjectId,
          "local.process.list",
          trMain("ui.18cf322cd643"),
          localProjectId,
          async () => {
            const processes = (await this.options.workerClient.listProcesses())
              .filter((process) => process.localProjectId === localProjectId)
              .map(sanitizeProcess);
            return {
              content: stringifyToolResult({ processes }),
              summary: trMain("ui.e95f25a7aa52", [processes.length])
            };
          },
          approvalMode
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
            title: trMain("ui.e6198cb7ead1", [process.executable]),
            detail: processId,
            auditDetail: process.executable,
            approvalKey: processId
          },
          trMain("ui.d86dd8ca7d2b"),
          processId,
          async () => {
            const result = await this.options.workerClient.stopProcess(processId);
            return {
              content: stringifyToolResult(sanitizeProcess(result)),
              summary: trMain("ui.d300444035b6", [result.executable, result.processId])
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_navigate") {
        assertNoUnexpectedKeys(args, ["url"]);
        const url = requiredString(args, "url", MAX_BROWSER_URL_LENGTH);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.navigate",
            risk: "R1",
            title: "AI requests Attached Browser navigation",
            detail: clipDetail(url),
            auditDetail: "Attached Browser",
            approvalKey: `attached:navigate:${url}`
          },
          "Navigate attached browser",
          clipDetail(url),
          async () => {
            throwIfAborted(signal);
            const state = await browser.navigate(url);
            return {
              content: stringifyToolResult({
                connected: state.connected,
                target_id: state.target?.targetId ?? null,
                title: state.target?.title ?? "",
                url: sanitizeBrowserToolUrl(state.target?.url ?? "about:blank")
              }),
              summary: `Navigated Attached Browser to ${sanitizeBrowserToolUrl(state.target?.url ?? url)}`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_inspect") {
        assertNoUnexpectedKeys(args, ["max_elements"]);
        const maxElements = optionalInteger(args, "max_elements", 1, 500, 200);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R2",
            title: "AI requests Attached Browser DOM inspection",
            detail: browser.state().target?.title ?? "Attached Browser",
            auditDetail: "Attached Browser visible DOM",
            approvalKey: `attached:dom:${browser.state().target?.targetId ?? "page"}`
          },
          "Inspect attached browser",
          browser.state().target?.title ?? "Attached Browser",
          async () => {
            throwIfAborted(signal);
            const inspected = await browser.inspect(maxElements);
            const clipped = clipText(inspected.text);
            return {
              content: stringifyToolResult({
                page_id: inspected.pageId,
                url: inspected.url,
                title: inspected.title,
                text: clipped.text,
                text_truncated: clipped.truncated,
                elements: inspected.elements.map(sanitizeBrowserDomElement),
                elements_truncated: inspected.truncated
              }),
              summary: `Inspected ${inspected.elements.length} Attached Browser element(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_click_ref") {
        assertNoUnexpectedKeys(args, ["ref_id"]);
        const refId = requiredString(args, "ref_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.click",
            risk: "R2",
            title: "AI requests an Attached Browser click",
            detail: refId,
            auditDetail: "Attached Browser inspected element reference",
            approvalKey: `attached:click-ref:${refId}`
          },
          "Click attached browser element",
          refId,
          async () => {
            throwIfAborted(signal);
            const result = await browser.clickRef(refId);
            return {
              content: stringifyToolResult(sanitizeBrowserElementAction(result)),
              summary: `Clicked Attached Browser ${result.target.tag} element`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_type_ref") {
        assertNoUnexpectedKeys(args, ["ref_id", "text"]);
        const refId = requiredString(args, "ref_id", MAX_BROWSER_ID_LENGTH);
        const text = requiredBrowserText(args);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.type",
            risk: "R2",
            title: "AI requests Attached Browser input",
            detail: refId,
            auditDetail: "Attached Browser inspected element reference",
            approvalKey: `attached:type-ref:${refId}:${sha256(text)}`
          },
          "Type in attached browser",
          refId,
          async () => {
            throwIfAborted(signal);
            const result = await browser.typeRef(refId, text);
            return {
              content: stringifyToolResult(sanitizeBrowserElementAction(result)),
              summary: `Typed into Attached Browser ${result.target.tag} element`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_get_console") {
        assertNoUnexpectedKeys(args, ["limit"]);
        const limit = optionalInteger(args, "limit", 1, 200, 100);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R2",
            title: "AI requests Attached Browser console output",
            detail: browser.state().target?.title ?? "Attached Browser",
            auditDetail: "Attached Browser console",
            approvalKey: `attached:console:${browser.state().target?.targetId ?? "page"}`
          },
          "Read attached browser console",
          browser.state().target?.title ?? "Attached Browser",
          async () => {
            throwIfAborted(signal);
            const entries = browser.getConsole(limit);
            return {
              content: stringifyToolResult({ entries: entries.map(sanitizeBrowserConsoleEntry) }),
              summary: `Read ${entries.length} Attached Browser console entr${entries.length === 1 ? "y" : "ies"}`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_get_network") {
        assertNoUnexpectedKeys(args, ["limit"]);
        const limit = optionalInteger(args, "limit", 1, 300, 100);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R2",
            title: "AI requests Attached Browser network metadata",
            detail: browser.state().target?.title ?? "Attached Browser",
            auditDetail: "Attached Browser Network metadata",
            approvalKey: `attached:network:${browser.state().target?.targetId ?? "page"}`
          },
          "Read attached browser network",
          browser.state().target?.title ?? "Attached Browser",
          async () => {
            throwIfAborted(signal);
            const entries = browser.getNetwork(limit);
            return {
              content: stringifyToolResult({ entries: entries.map(sanitizeBrowserNetworkEntry) }),
              summary: `Read ${entries.length} Attached Browser network request(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_get_network_body") {
        assertNoUnexpectedKeys(args, ["request_id", "max_characters"]);
        const requestId = requiredString(args, "request_id", MAX_BROWSER_ID_LENGTH);
        const maxCharacters = optionalInteger(args, "max_characters", 1, 200_000, 100_000);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R3",
            title: "AI requests an Attached Browser response body",
            detail: requestId,
            auditDetail: "Attached Browser Network response body",
            approvalKey: `attached:network-body:${requestId}`
          },
          "Read attached response body",
          requestId,
          async () => {
            throwIfAborted(signal);
            const result = await browser.getNetworkBody(requestId, maxCharacters);
            return {
              content: stringifyToolResult({
                request_id: result.requestId,
                mime_type: result.mimeType,
                body: result.body,
                base64_encoded: result.base64Encoded,
                truncated: result.truncated
              }),
              summary: `Read ${result.body.length} Attached Browser response character(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_attached_screenshot") {
        assertNoUnexpectedKeys(args, []);
        const browser = this.requireAttachedBrowser();
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.screenshot",
            risk: "R2",
            title: "AI requests an Attached Browser screenshot",
            detail: browser.state().target?.title ?? "Attached Browser",
            auditDetail: "Attached Browser screenshot",
            approvalKey: `attached:screenshot:${browser.state().target?.targetId ?? "page"}`
          },
          "Capture attached browser screenshot",
          browser.state().target?.title ?? "Attached Browser",
          async () => {
            throwIfAborted(signal);
            const dataUrl = await browser.screenshot("agent");
            return {
              content: stringifyToolResult({
                target_id: browser.state().target?.targetId ?? null,
                url: sanitizeBrowserToolUrl(browser.state().target?.url ?? "about:blank"),
                image_attached: true
              }),
              summary: "Captured Attached Browser screenshot",
              images: [dataUrl]
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_get_state") {
        assertNoUnexpectedKeys(args, []);
        return await this.runPassive(
          localProjectId,
          "local.browser.read",
          trMain("ui.3a0191f541dd"),
          localProjectId,
          async () => {
            const state = await this.requireBrowser().getState(localProjectId);
            return {
              content: stringifyToolResult(sanitizeBrowserState(state)),
              summary: trMain("ui.0391ccac18e5", [state.pages.length])
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_request_user_login") {
        assertNoUnexpectedKeys(args, ["page_id"]);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runPassive(
          localProjectId,
          "local.browser.takeover",
          "Request user login",
          pageId ?? "active page",
          async () => {
            throwIfAborted(signal);
            if (pageId) await browser.selectPage(localProjectId, pageId);
            const state = await browser.setUserTakeover(
              localProjectId,
              true,
              pageId,
              context
            );
            return {
              content: stringifyToolResult({
                requires_user_action: true,
                action: "sign_in_in_managed_browser",
                page_id: state.activePageId,
                url: sanitizeBrowserToolUrl(state.url),
                user_takeover: state.userTakeover,
                instructions:
                  "Sign in directly in the Managed Browser. Enter the password there or use any password manager, passkey, verification code, QR scan or CAPTCHA available on that page; do not send credentials in chat. When finished, return control to the Agent and tell it to continue."
              }),
              summary: "Waiting for the user to sign in in the Managed Browser"
            };
          },
          approvalMode
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
            title: trMain("ui.b4196f0460fb"),
            detail,
            auditDetail: "Managed Browser",
            approvalKey: `${profileId ?? "default"}:${detail}`
          },
          trMain("ui.92ab1f079b05"),
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
              created.activePageId,
              context
            );
            return {
              content: stringifyToolResult(sanitizeBrowserState(state)),
              summary: browserPageSummary(state)
            };
          },
          approvalMode
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
            title: trMain("ui.bc8abfe2af95"),
            detail: clipDetail(url),
            auditDetail: "Managed Browser",
            approvalKey: `${pageId ?? "active"}:${url}`
          },
          trMain("ui.22d040b33dbe"),
          clipDetail(url),
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const state = await browser.navigate(localProjectId, url, pageId, context);
            return {
              content: stringifyToolResult(sanitizeBrowserState(state)),
              summary: browserPageSummary(state)
            };
          },
          approvalMode
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
            title: trMain("ui.6e1ae20aaf13"),
            detail: clipDetail(selector),
            auditDetail: "Managed Browser DOM selector",
            approvalKey: `${pageId ?? "active"}:${selector}`
          },
          trMain("ui.21c2547386d0"),
          clipDetail(selector),
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(
              browser,
              localProjectId,
              pageId
            );
            await browser.click(localProjectId, selector, pageId, context);
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: before.activePageId,
                url: before.url
              }),
              summary: trMain("ui.1c98c9041630", [selector])
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_click_at") {
        assertNoUnexpectedKeys(args, ["x", "y", "page_id"]);
        const x = requiredInteger(args, "x", 0, 100_000);
        const y = requiredInteger(args, "y", 0, 100_000);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.click",
            risk: "R2",
            title: "AI requests a browser coordinate click",
            detail: `${x}, ${y}`,
            auditDetail: "Managed Browser mouse input",
            approvalKey: `${pageId ?? "active"}:${x}:${y}`
          },
          "Click browser coordinates",
          `${x}, ${y}`,
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(
              browser,
              localProjectId,
              pageId
            );
            await browser.clickPoint(localProjectId, x, y, pageId, context);
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: before.activePageId,
                url: before.url,
                x,
                y
              }),
              summary: `Clicked browser coordinates ${x}, ${y}`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_click_ref") {
        assertNoUnexpectedKeys(args, ["ref_id", "page_id"]);
        const refId = requiredString(args, "ref_id", MAX_BROWSER_ID_LENGTH);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.click",
            risk: "R2",
            title: "AI requests a referenced browser click",
            detail: refId,
            auditDetail: "Managed Browser inspected element reference",
            approvalKey: `${pageId ?? "active"}:click-ref:${refId}`
          },
          "Click referenced browser element",
          refId,
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const result = await browser.clickRef(localProjectId, refId, pageId, context);
            return {
              content: stringifyToolResult(sanitizeBrowserElementAction(result)),
              summary: `Clicked referenced ${result.target.tag} element`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_scroll") {
        assertNoUnexpectedKeys(args, ["delta_x", "delta_y", "page_id"]);
        const deltaX = optionalInteger(args, "delta_x", -100_000, 100_000, 0);
        const deltaY = requiredInteger(args, "delta_y", -100_000, 100_000);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.click",
            risk: "R2",
            title: "AI requests browser scrolling",
            detail: `${deltaX}, ${deltaY}`,
            auditDetail: "Managed Browser mouse wheel",
            approvalKey: `${pageId ?? "active"}:scroll:${deltaX}:${deltaY}`
          },
          "Scroll browser page",
          `${deltaX}, ${deltaY}`,
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            await browser.scroll(localProjectId, deltaX, deltaY, pageId, context);
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: before.activePageId,
                url: before.url,
                delta_x: deltaX,
                delta_y: deltaY
              }),
              summary: `Scrolled browser by ${deltaX}, ${deltaY}`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_press") {
        assertNoUnexpectedKeys(args, ["key", "modifiers", "page_id"]);
        const key = requiredString(args, "key", 32);
        const modifiers = args.modifiers === undefined
          ? []
          : requiredStringArray(args, "modifiers", 4, 16);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.type",
            risk: "R2",
            title: "AI requests a browser key press",
            detail: [...modifiers, key].join("+"),
            auditDetail: "Managed Browser keyboard input",
            approvalKey: `${pageId ?? "active"}:key:${modifiers.join("+")}:${key}`
          },
          "Press browser key",
          [...modifiers, key].join("+"),
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            await browser.press(localProjectId, key, modifiers, pageId, context);
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: before.activePageId,
                url: before.url,
                key,
                modifiers
              }),
              summary: `Pressed ${[...modifiers, key].join("+")}`
            };
          },
          approvalMode
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
            title: trMain("ui.9d9aba09b60a"),
            detail: clipDetail(selector),
            auditDetail: "Managed Browser DOM input",
            approvalKey: `${pageId ?? "active"}:${selector}:${sha256(text)}`
          },
          trMain("ui.7b93ef577697"),
          clipDetail(selector),
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(
              browser,
              localProjectId,
              pageId
            );
            await browser.type(localProjectId, selector, text, pageId, context);
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: before.activePageId,
                url: before.url,
                characters: text.length
              }),
              summary: trMain("ui.a73c079e96e6", [text.length])
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_type_ref") {
        assertNoUnexpectedKeys(args, ["ref_id", "text", "page_id"]);
        const refId = requiredString(args, "ref_id", MAX_BROWSER_ID_LENGTH);
        const text = requiredBrowserText(args);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.type",
            risk: "R2",
            title: "AI requests referenced browser input",
            detail: refId,
            auditDetail: "Managed Browser inspected element reference",
            approvalKey: `${pageId ?? "active"}:type-ref:${refId}:${sha256(text)}`
          },
          "Type into referenced browser element",
          refId,
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const result = await browser.typeRef(localProjectId, refId, text, pageId, context);
            return {
              content: stringifyToolResult(sanitizeBrowserElementAction(result)),
              summary: `Typed into referenced ${result.target.tag} element`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_upload") {
        assertNoUnexpectedKeys(args, ["selector", "relative_paths", "page_id"]);
        const selector = requiredString(args, "selector", MAX_BROWSER_SELECTOR_LENGTH);
        const relativePaths = requiredStringArray(args, "relative_paths", 20, MAX_PATH_LENGTH);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.upload",
            risk: "R3",
            title: trMain("ui.b6a06fc0943a"),
            detail: trMain("ui.b569fc78af6f", [clipDetail(selector), relativePaths.length]),
            auditDetail: relativePaths.join(", "),
            approvalKey: `${pageId ?? "active"}:${selector}:${sha256(JSON.stringify(relativePaths))}`
          },
          trMain("ui.a40b283a86f3"),
          relativePaths.join(", "),
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const result = await browser.upload(
              localProjectId,
              selector,
              relativePaths,
              pageId,
              context
            );
            return {
              content: stringifyToolResult({
                completed: true,
                page_id: result.pageId,
                url: result.url,
                relative_paths: result.relativePaths
              }),
              summary: trMain("ui.e8b348e887de", [result.relativePaths.length])
            };
          },
          approvalMode
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
            title: trMain("ui.d3bc20c2ed37"),
            detail: clipDetail(selector),
            auditDetail: "Managed Browser DOM selector",
            approvalKey: `${pageId ?? "active"}:${selector}`
          },
          trMain("ui.074c72c437c6"),
          clipDetail(selector),
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(
              browser,
              localProjectId,
              pageId
            );
            const extracted = clipText(
              await browser.extract(localProjectId, selector, pageId, context)
            );
            return {
              content: stringifyToolResult({
                page_id: before.activePageId,
                url: before.url,
                selector,
                text: extracted.text,
                truncated: extracted.truncated
              }),
              summary: trMain("ui.864b87e5af1e", [extracted.text.length])
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_inspect") {
        assertNoUnexpectedKeys(args, ["page_id", "max_elements"]);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const maxElements = optionalInteger(args, "max_elements", 1, 500, 200);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R1",
            title: "AI requests browser DOM inspection",
            detail: pageId ?? "active page",
            auditDetail: "Managed Browser visible DOM",
            approvalKey: `${pageId ?? "active"}:dom`
          },
          "Inspect browser DOM",
          pageId ?? "active page",
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const inspected = await browser.inspect(localProjectId, pageId, maxElements);
            const text = clipText(inspected.text);
            return {
              content: stringifyToolResult({
                page_id: inspected.pageId,
                url: inspected.url,
                title: inspected.title,
                text: text.text,
                text_truncated: text.truncated,
                elements: inspected.elements.map((element) => ({
                  index: element.index,
                  ref_id: element.refId,
                  tag: element.tag,
                  role: element.role,
                  name: element.name,
                  text: element.text,
                  selector: element.selector,
                  locator: element.locator,
                  context: element.context,
                  input_type: element.inputType,
                  href: element.href,
                  disabled: element.disabled,
                  checked: element.checked,
                  x: element.x,
                  y: element.y,
                  center_x: element.centerX,
                  center_y: element.centerY,
                  width: element.width,
                  height: element.height
                })),
                elements_truncated: inspected.truncated
              }),
              summary: `Inspected ${inspected.elements.length} interactive element(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_wait_for") {
        assertNoUnexpectedKeys(args, ["condition", "value", "timeout_ms", "page_id"]);
        const conditionValue = requiredString(args, "condition", 16);
        if (!["load", "selector", "text"].includes(conditionValue)) {
          throw new Error("condition must be load, selector or text.");
        }
        const condition = conditionValue as "load" | "selector" | "text";
        const value = optionalString(args, "value", MAX_BROWSER_TEXT_LENGTH);
        const timeoutMs = optionalInteger(args, "timeout_ms", 100, 30_000, 10_000);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runPassive(
          localProjectId,
          "local.browser.read",
          "Wait for browser page",
          condition,
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const result = await browser.waitFor(
              localProjectId,
              condition,
              value,
              timeoutMs,
              pageId
            );
            return {
              content: stringifyToolResult({
                page_id: result.pageId,
                url: result.url,
                condition: result.condition,
                matched: result.matched,
                elapsed_ms: result.elapsedMs
              }),
              summary: `Browser ${condition} condition matched`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_get_console") {
        assertNoUnexpectedKeys(args, ["page_id", "limit"]);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const limit = optionalInteger(args, "limit", 1, 200, 100);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R1",
            title: "AI requests browser console output",
            detail: pageId ?? "active page",
            auditDetail: "Managed Browser console",
            approvalKey: `${pageId ?? "active"}:console`
          },
          "Read browser console",
          pageId ?? "active page",
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const entries = await browser.getConsole(localProjectId, pageId, limit);
            return {
              content: stringifyToolResult({
                entries: entries.map((entry) => ({
                  entry_id: entry.entryId,
                  page_id: entry.pageId,
                  level: entry.level,
                  message: entry.message,
                  source: entry.source,
                  line: entry.line,
                  timestamp: entry.timestamp
                }))
              }),
              summary: `Read ${entries.length} browser console entr${entries.length === 1 ? "y" : "ies"}`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_get_network") {
        assertNoUnexpectedKeys(args, ["page_id", "limit"]);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const limit = optionalInteger(args, "limit", 1, 200, 100);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R1",
            title: "AI requests browser network activity",
            detail: pageId ?? "active page",
            auditDetail: "Managed Browser network metadata",
            approvalKey: `${pageId ?? "active"}:network`
          },
          "Read browser network",
          pageId ?? "active page",
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const entries = await browser.getNetwork(localProjectId, pageId, limit);
            return {
              content: stringifyToolResult({
                entries: entries.map((entry) => ({
                  request_id: entry.requestId,
                  page_id: entry.pageId,
                  method: entry.method,
                  url: entry.url,
                  resource_type: entry.resourceType,
                  status: entry.status,
                  status_line: entry.statusLine,
                  mime_type: entry.mimeType,
                  request_headers: entry.requestHeaders,
                  response_headers: entry.responseHeaders,
                  from_cache: entry.fromCache,
                  failed: entry.failed,
                  error: entry.error,
                  started_at: entry.startedAt,
                  finished_at: entry.finishedAt,
                  duration_ms: entry.durationMs
                }))
              }),
              summary: `Read ${entries.length} browser network request(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_get_network_body") {
        assertNoUnexpectedKeys(args, ["request_id", "max_characters", "page_id"]);
        const requestId = requiredString(args, "request_id", MAX_BROWSER_ID_LENGTH);
        const maxCharacters = optionalInteger(
          args,
          "max_characters",
          1,
          200_000,
          100_000
        );
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R2",
            title: "AI requests a browser response body",
            detail: requestId,
            auditDetail: "Managed Browser Network response body",
            approvalKey: `${pageId ?? "active"}:network-body:${requestId}`
          },
          "Read browser response body",
          requestId,
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const result = await browser.getNetworkBody(
              localProjectId,
              requestId,
              pageId,
              maxCharacters
            );
            return {
              content: stringifyToolResult({
                request_id: result.requestId,
                mime_type: result.mimeType,
                body: result.body,
                base64_encoded: result.base64Encoded,
                truncated: result.truncated
              }),
              summary: `Read ${result.body.length} response body character(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_get_performance") {
        assertNoUnexpectedKeys(args, ["page_id"]);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R1",
            title: "AI requests browser performance metrics",
            detail: pageId ?? "active page",
            auditDetail: "Managed Browser Navigation and Resource Timing",
            approvalKey: `${pageId ?? "active"}:performance`
          },
          "Read browser performance",
          pageId ?? "active page",
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const performance = await browser.getPerformance(localProjectId, pageId);
            return {
              content: stringifyToolResult(sanitizeBrowserPerformance(performance)),
              summary: `Read performance metrics for ${performance.resources.count} resource(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_get_diagnostics") {
        assertNoUnexpectedKeys(args, ["page_id", "console_limit", "network_limit"]);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const consoleLimit = optionalInteger(args, "console_limit", 1, 200, 100);
        const networkLimit = optionalInteger(args, "network_limit", 1, 200, 100);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.read",
            risk: "R1",
            title: "AI requests a browser diagnostics snapshot",
            detail: pageId ?? "active page",
            auditDetail: "Managed Browser console, network and performance summary",
            approvalKey: `${pageId ?? "active"}:diagnostics:${consoleLimit}:${networkLimit}`
          },
          "Diagnose browser page",
          pageId ?? "active page",
          async () => {
            throwIfAborted(signal);
            await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const [consoleEntries, networkEntries, performance] = await Promise.all([
              browser.getConsole(localProjectId, pageId, consoleLimit),
              browser.getNetwork(localProjectId, pageId, networkLimit),
              browser.getPerformance(localProjectId, pageId)
            ]);
            const consoleProblems = consoleEntries.filter(
              (entry) => entry.level === "warning" || entry.level === "error"
            );
            const networkProblems = networkEntries.filter(
              (entry) => entry.failed || (entry.status !== null && entry.status >= 400)
            );
            return {
              content: stringifyToolResult({
                page_id: performance.pageId,
                url: performance.url,
                summary: {
                  console_entries_inspected: consoleEntries.length,
                  console_problems: consoleProblems.length,
                  network_entries_inspected: networkEntries.length,
                  network_problems: networkProblems.length
                },
                console_problems: consoleProblems.map((entry) => ({
                  level: entry.level,
                  message: entry.message,
                  source: entry.source,
                  line: entry.line,
                  timestamp: entry.timestamp
                })),
                network_problems: networkProblems.map((entry) => ({
                  request_id: entry.requestId,
                  method: entry.method,
                  url: entry.url,
                  resource_type: entry.resourceType,
                  status: entry.status,
                  failed: entry.failed,
                  error: entry.error,
                  duration_ms: entry.durationMs
                })),
                performance: sanitizeBrowserPerformance(performance)
              }),
              summary: `Found ${consoleProblems.length + networkProblems.length} browser problem(s)`
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_export_har") {
        assertNoUnexpectedKeys(args, ["path", "page_id", "limit"]);
        const path = requiredPath(args);
        if (!path.toLowerCase().endsWith(".har")) {
          throw new Error("Browser HAR export path must end with .har.");
        }
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const limit = optionalInteger(args, "limit", 1, 300, 300);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.fs.create",
            risk: "R2",
            title: "AI requests a redacted browser HAR export",
            detail: path,
            auditDetail: "Managed Browser HAR without bodies or cookies",
            approvalKey: `${pageId ?? "active"}:har:${path}:${limit}`
          },
          "Export browser HAR",
          path,
          async () => {
            throwIfAborted(signal);
            const state = await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const entries = await browser.getNetwork(localProjectId, pageId, limit);
            const text = JSON.stringify(
              buildRedactedHar(state.activePageId ?? "page", state.title, state.url, entries),
              null,
              2
            );
            const result = await this.options.workerClient.createProjectFile(
              localProjectId,
              path,
              text
            );
            const artifact = {
              id: `artifact_${sha256(`${localProjectId}:${path}:${result.sha256}`).slice(0, 24)}`,
              kind: "file" as const,
              relativePath: path,
              filename: path.split("/").at(-1)!,
              mimeType: "application/json",
              size: result.bytesRead,
              uri: result.uri,
              providerId: "ai.routemarket.browser-har"
            };
            return {
              content: stringifyToolResult({
                path,
                request_count: entries.length,
                includes_response_bodies: false,
                includes_cookies: false,
                output_files: [artifact]
              }),
              summary: `Exported ${entries.length} request(s) to ${path}`,
              artifacts: [artifact]
            };
          },
          approvalMode
        );
      }

      if (call.name === "browser_screenshot") {
        assertNoUnexpectedKeys(args, ["page_id"]);
        const pageId = optionalString(args, "page_id", MAX_BROWSER_ID_LENGTH);
        const browser = this.requireBrowser();
        await this.assertAgentBrowserControl(browser, localProjectId, pageId);
        return await this.runAuthorized(
          localProjectId,
          {
            capability: "local.browser.screenshot",
            risk: "R1",
            title: "AI requests a browser screenshot",
            detail: pageId ?? "active page",
            auditDetail: "Managed Browser screenshot",
            approvalKey: `${pageId ?? "active"}:screenshot`
          },
          trMain("ui.963479826cf8"),
          pageId ?? "active page",
          async () => {
            throwIfAborted(signal);
            const before = await this.activateAgentBrowserPage(browser, localProjectId, pageId);
            const dataUrl = await browser.screenshot(
              localProjectId,
              pageId,
              context,
              "agent"
            );
            return {
              content: stringifyToolResult({
                page_id: before.activePageId,
                url: before.url,
                image_attached: true
              }),
              summary: "Captured browser screenshot",
              images: [dataUrl]
            };
          },
          approvalMode
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
        summary: error instanceof Error ? error.message : trMain("ui.e6afb576b3db"),
        isError: true
      };
    }
  }

  private async runRead(
    localProjectId: string,
    title: string,
    detail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>,
    approvalMode: ToolApprovalMode
  ): Promise<ProjectChatToolExecution> {
    return this.runWithActivity(title, detail, () =>
      this.options.toolBroker.run(
        {
          capability: "local.fs.read",
          risk: "R0",
          title,
          detail,
          projectId: localProjectId,
          approvalMode
        },
        operation
      )
    );
  }

  private async runPassive(
    localProjectId: string,
    capability: string,
    title: string,
    detail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>,
    approvalMode: ToolApprovalMode
  ): Promise<ProjectChatToolExecution> {
    return this.runWithActivity(title, detail, () =>
      this.options.toolBroker.run(
        {
          capability,
          risk: "R0",
          title,
          detail,
          projectId: localProjectId,
          approvalMode
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
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>,
    approvalMode: ToolApprovalMode
  ): Promise<ProjectChatToolExecution> {
    return this.runAuthorized(
      localProjectId,
      { ...authorization, risk: "R1" },
      activityTitle,
      activityDetail,
      operation,
      approvalMode
    );
  }

  private async runAuthorized(
    localProjectId: string,
    authorization: {
      capability: string;
      risk: ToolRisk;
      title: string;
      detail: string;
      auditDetail?: string;
      approvalKey: string;
    },
    activityTitle: string,
    activityDetail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>,
    approvalMode: ToolApprovalMode
  ): Promise<ProjectChatToolExecution> {
    return this.runWithActivity(activityTitle, activityDetail, () =>
      this.options.toolBroker.run(
        {
          ...authorization,
          projectId: localProjectId,
          approvalMode
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

  private requireAttachedBrowser(): ProjectChatAttachedBrowser {
    const browser = this.options.getAttachedBrowser?.();
    if (!browser?.state().connected) {
      throw new Error("Attached Browser is not connected. Connect it from the Browser UI first.");
    }
    return browser;
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

function requiredInteger(
  args: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number {
  if (args[key] === undefined) throw new Error(`${key} is required.`);
  return optionalInteger(args, key, minimum, maximum, minimum);
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
    downloads: state.downloads.map((download) => ({
      download_id: download.downloadId,
      page_id: download.pageId,
      file_name: download.fileName,
      relative_path: download.relativePath,
      status: download.status,
      received_bytes: download.receivedBytes,
      total_bytes: download.totalBytes,
      started_at: download.startedAt,
      finished_at: download.finishedAt
    })),
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

function sanitizeBrowserElementAction(result: ManagedBrowserElementActionResult) {
  return {
    completed: result.completed,
    page_id: result.pageId,
    ref_id: result.refId,
    url_before: result.urlBefore,
    url_after: result.urlAfter,
    navigated: result.navigated,
    target: {
      tag: result.target.tag,
      role: result.target.role,
      name: result.target.name,
      input_type: result.target.inputType,
      x: result.target.x,
      y: result.target.y
    }
  };
}

function sanitizeBrowserDomElement(element: ManagedBrowserDomElement) {
  return {
    index: element.index,
    ref_id: element.refId,
    tag: element.tag,
    role: element.role,
    name: element.name,
    text: element.text,
    selector: element.selector,
    locator: element.locator,
    context: element.context,
    input_type: element.inputType,
    href: element.href,
    disabled: element.disabled,
    checked: element.checked,
    x: element.x,
    y: element.y,
    center_x: element.centerX,
    center_y: element.centerY,
    width: element.width,
    height: element.height
  };
}

function sanitizeBrowserConsoleEntry(entry: ManagedBrowserConsoleEntry) {
  return {
    entry_id: entry.entryId,
    page_id: entry.pageId,
    level: entry.level,
    message: entry.message,
    source: entry.source,
    line: entry.line,
    timestamp: entry.timestamp
  };
}

function sanitizeBrowserNetworkEntry(entry: ManagedBrowserNetworkEntry) {
  return {
    request_id: entry.requestId,
    page_id: entry.pageId,
    method: entry.method,
    url: entry.url,
    resource_type: entry.resourceType,
    status: entry.status,
    status_line: entry.statusLine,
    mime_type: entry.mimeType,
    request_headers: entry.requestHeaders,
    response_headers: entry.responseHeaders,
    from_cache: entry.fromCache,
    failed: entry.failed,
    error: entry.error,
    started_at: entry.startedAt,
    finished_at: entry.finishedAt,
    duration_ms: entry.durationMs
  };
}

function sanitizeBrowserToolUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|passwd|auth|session|code|key/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString().slice(0, MAX_BROWSER_URL_LENGTH);
  } catch {
    return value.slice(0, MAX_BROWSER_URL_LENGTH);
  }
}

function sanitizeBrowserPerformance(performance: ManagedBrowserPerformance) {
  return {
    page_id: performance.pageId,
    url: performance.url,
    captured_at: performance.capturedAt,
    time_origin: performance.timeOrigin,
    navigation_type: performance.navigationType,
    timings: {
      response_start_ms: performance.timings.responseStartMs,
      response_end_ms: performance.timings.responseEndMs,
      dom_interactive_ms: performance.timings.domInteractiveMs,
      dom_content_loaded_ms: performance.timings.domContentLoadedMs,
      load_event_ms: performance.timings.loadEventMs,
      first_paint_ms: performance.timings.firstPaintMs,
      first_contentful_paint_ms: performance.timings.firstContentfulPaintMs
    },
    resources: {
      count: performance.resources.count,
      transfer_size: performance.resources.transferSize,
      encoded_body_size: performance.resources.encodedBodySize,
      decoded_body_size: performance.resources.decodedBodySize,
      slowest: performance.resources.slowest.map((resource) => ({
        url: resource.url,
        initiator_type: resource.initiatorType,
        start_time_ms: resource.startTimeMs,
        duration_ms: resource.durationMs,
        transfer_size: resource.transferSize,
        encoded_body_size: resource.encodedBodySize,
        decoded_body_size: resource.decodedBodySize
      }))
    }
  };
}

export function buildRedactedHar(
  pageId: string,
  title: string,
  url: string,
  entries: ManagedBrowserNetworkEntry[]
): Record<string, unknown> {
  const startedAt = entries[0]?.startedAt ?? new Date().toISOString();
  return {
    log: {
      version: "1.2",
      creator: { name: "RouteMarket Managed Browser", version: "1" },
      pages: [{
        startedDateTime: startedAt,
        id: pageId,
        title,
        pageTimings: {},
        _url: url
      }],
      entries: entries.map((entry) => ({
        pageref: pageId,
        startedDateTime: entry.startedAt,
        time: entry.durationMs ?? 0,
        request: {
          method: entry.method,
          url: entry.url,
          httpVersion: "",
          cookies: [],
          headers: toHarHeaders(entry.requestHeaders),
          queryString: toHarQuery(entry.url),
          headersSize: -1,
          bodySize: -1
        },
        response: {
          status: entry.status ?? 0,
          statusText: harStatusText(entry.statusLine),
          httpVersion: "",
          cookies: [],
          headers: toHarHeaders(entry.responseHeaders),
          content: {
            size: -1,
            mimeType: entry.mimeType ?? ""
          },
          redirectURL: harRedirectUrl(entry.responseHeaders.location),
          headersSize: -1,
          bodySize: -1
        },
        cache: {},
        timings: {
          blocked: -1,
          dns: -1,
          connect: -1,
          send: 0,
          wait: entry.durationMs ?? 0,
          receive: 0,
          ssl: -1
        },
        _requestId: entry.requestId,
        _resourceType: entry.resourceType,
        _fromCache: entry.fromCache,
        _failed: entry.failed,
        _error: entry.error
      }))
    }
  };
}

function toHarHeaders(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers)
    .filter(([name]) => !/^(?:cookie|set-cookie)$/i.test(name))
    .map(([name, value]) => ({ name, value }));
}

function toHarQuery(value: string): Array<{ name: string; value: string }> {
  try {
    return [...new URL(value).searchParams.entries()].map(([name, queryValue]) => ({
      name,
      value: queryValue
    }));
  } catch {
    return [];
  }
}

function harStatusText(statusLine: string | null): string {
  return statusLine?.replace(/^HTTP\/\S+\s+\d+\s*/i, "").slice(0, 256) ?? "";
}

function harRedirectUrl(value: string | undefined): string {
  if (!value || value === "[redacted]") return "";
  try {
    const redirect = new URL(value);
    redirect.username = "";
    redirect.password = "";
    for (const key of [...redirect.searchParams.keys()]) {
      if (/token|secret|password|passwd|auth|session|code|key/i.test(key)) {
        redirect.searchParams.set(key, "[redacted]");
      }
    }
    return redirect.toString().slice(0, MAX_BROWSER_URL_LENGTH);
  } catch {
    return "";
  }
}

function browserPageSummary(state: ManagedBrowserState): string {
  return `${state.title || state.url || "about:blank"} · ${state.activePageId}`;
}

function processSummary(process: ManagedProcessSummary): string {
  if (process.status === "running") {
    return trMain("ui.49f955ab20c4", [process.executable, process.processId]);
  }
  const exit = process.exitCode === null ? process.status : trMain("ui.332406fe86d2", [process.exitCode]);
  return trMain("ui.6592e1093c7b", [process.executable, exit]);
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

function mimeTypeForPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase();
  if (extension === "md" || extension === "txt") return "text/plain";
  if (extension === "json") return "application/json";
  if (extension === "har") return "application/json";
  if (extension === "csv") return "text/csv";
  if (extension === "html" || extension === "htm") return "text/html";
  if (extension === "svg") return "image/svg+xml";
  return "application/octet-stream";
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
