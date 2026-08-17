import { trMain } from "./i18n";
import { createHash } from "node:crypto";
import type {
  DesktopWorkflowDraftNode,
  NativeAppConnectorId
} from "../shared/desktop-api";
import type { CloudWorkflowClient } from "./cloud-workflow-client";
import type { LocalWorkflowNodeExecutor } from "./local-workflow-runtime";
import type { ManagedBrowserManager } from "./managed-browser-manager";
import type { NativeAppConnectorManager } from "./native-app-connector-manager";
import type { LocalToolBroker, ToolRisk } from "./tool-broker";
import type { WorkerClient } from "./worker-client";
import {
  exportProductPriceCsv,
  extractProductPrice,
  type ProductPriceRecord
} from "./workflow-product-data";

type ExecutorOptions = {
  cloudWorkflowClient: Pick<CloudWorkflowClient, "executeNode">;
  workerClient: WorkerClient;
  toolBroker: LocalToolBroker;
  getBrowser(): ManagedBrowserManager;
  nativeAppConnectors: NativeAppConnectorManager;
};

export function createLocalWorkflowNodeExecutor(
  options: ExecutorOptions
): LocalWorkflowNodeExecutor {
  return async (node, input, signal) => {
    throwIfAborted(signal);
    if (!node.definitionSnapshot.available) {
      throw new Error(
        `Workflow node is unavailable: ${node.definitionSnapshot.blockedReason ?? node.executorKey}`
      );
    }
    if (node.executionTarget === "cloud") {
      return options.cloudWorkflowClient.executeNode(node, input, signal);
    }
    if (
      node.executorKey.startsWith("desktop.trigger.") ||
      node.executorKey === "control.approval"
    ) {
      throw new Error(
        `${node.executorKey} cannot be executed as a normal node in a manual local run.`
      );
    }

    const localProjectId = requiredString(input, "$localProjectId", 128, true);
    return executeNode(options, node, input, localProjectId, signal);
  };
}

async function executeNode(
  options: ExecutorOptions,
  node: DesktopWorkflowDraftNode,
  input: Record<string, unknown>,
  localProjectId: string,
  signal: AbortSignal
): Promise<unknown> {
  const key = node.executorKey;
  if (key === "local.fs.read") {
    const relativePath = pathInput(input);
    return options.workerClient.readProjectFile(localProjectId, relativePath);
  }
  if (key === "local.fs.search") {
    return options.workerClient.searchProject(
      localProjectId,
      requiredString(input, "query", 256)
    );
  }
  if (key === "local.fs.write") {
    const relativePath = pathInput(input);
    const text = requiredString(input, "text", 1_000_000, true);
    const expectedSha256 = requiredString(input, "expectedSha256", 64);
    return authorize(
      options,
      localProjectId,
      key,
      "R1",
      `Allow Workflow to modify ${relativePath}?`,
      relativePath,
      `${expectedSha256}:${hash(text)}`,
      () => options.workerClient.writeProjectFile(
        localProjectId,
        relativePath,
        text,
        expectedSha256
      )
    );
  }
  if (key === "local.fs.create") {
    const relativePath = pathInput(input);
    const text = requiredString(input, "text", 1_000_000, true);
    return authorize(
      options,
      localProjectId,
      key,
      "R1",
      `Allow Workflow to create ${relativePath}?`,
      relativePath,
      `${relativePath}:${hash(text)}`,
      () => options.workerClient.createProjectFile(localProjectId, relativePath, text)
    );
  }
  if (key === "local.process.start") {
    const executable = requiredString(input, "executable", 1_024);
    const args = stringArray(input.args, "args");
    return authorize(
      options,
      localProjectId,
      key,
      "R2",
      `Allow Workflow to start ${executable}?`,
      [executable, ...args].join(" "),
      hash(JSON.stringify([executable, ...args])),
      () => options.workerClient.startProcess(localProjectId, executable, args)
    );
  }
  if (key === "local.process.stop") {
    const processId = requiredString(input, "processId", 128);
    const process = (await options.workerClient.listProcesses()).find(
      (candidate) =>
        candidate.processId === processId &&
        candidate.localProjectId === localProjectId
    );
    if (!process) throw new Error("Managed process was not found in this project.");
    return authorize(
      options,
      localProjectId,
      key,
      "R2",
      `Allow Workflow to stop ${process.executable}?`,
      processId,
      processId,
      () => options.workerClient.stopProcess(processId)
    );
  }
  if (key.startsWith("skill.local.")) {
    const skillId = await resolveProjectSkillId(
      options.workerClient,
      localProjectId,
      key,
      optionalString(input, "skillId", 256)
    );
    return options.workerClient.invokeProjectSkill(
      localProjectId,
      skillId,
      requiredString(input, "task", 16_000)
    );
  }
  if (key.startsWith("mcp__")) {
    return executeMcp(options, key, input, localProjectId);
  }
  if (key === "local.browser.product_extract") {
    const browser = options.getBrowser();
    return extractProductPrice(browser, {
      localProjectId,
      pageId:
        optionalString(input, "pageId", 256) ??
        optionalString(input, "activePageId", 256),
      sourceUrl: requiredString(
        input,
        "sourceUrl",
        8_192,
        false,
        optionalString(input, "url", 8_192)
      ),
      titleSelectors: optionalStringArray(input.titleSelectors, "titleSelectors", 16),
      priceSelectors: optionalStringArray(input.priceSelectors, "priceSelectors", 16)
    });
  }
  if (key.startsWith("local.browser.")) {
    return executeBrowser(options, key, input, localProjectId, signal);
  }
  if (key === "local.data.csv_export") {
    const outputDirectory = requiredString(input, "outputDirectory", 32_768);
    const fileName = optionalString(input, "fileName", 200);
    const record = productPriceRecord(input);
    return authorize(
      options,
      localProjectId,
      key,
      "R2",
      trMain("ui.ec6d2050fe47"),
      `${outputDirectory} / ${fileName ?? trMain("ui.5a55273c56e8")}`,
      hash(JSON.stringify({ outputDirectory, fileName, record })),
      () => exportProductPriceCsv({ outputDirectory, fileName, record })
    );
  }
  if (key.startsWith("local.app.") && key.endsWith(".open")) {
    const connectorId = key.slice("local.app.".length, -".open".length);
    if (!isConnectorId(connectorId)) throw new Error("Unknown native app connector.");
    const relativePath = optionalString(input, "relativePath", 4_096);
    return authorize(
      options,
      localProjectId,
      "local.app.open",
      "R2",
      `Allow Workflow to open project content in ${connectorId}?`,
      relativePath ?? ".",
      `${connectorId}:${relativePath ?? "."}`,
      async () => options.nativeAppConnectors.open(
        connectorId,
        await options.workerClient.projectRoot(localProjectId),
        relativePath
      )
    );
  }
  throw new Error(`Unsupported local Workflow executor: ${key}`);
}

async function resolveProjectSkillId(
  workerClient: WorkerClient,
  localProjectId: string,
  executorKey: string,
  requestedSkillId?: string
): Promise<string> {
  const suffix = executorKey.slice("skill.local.".length);
  const context = await workerClient.projectContext(localProjectId);
  const matches = context.skills.filter((skill) => sanitizeKey(skill.id) === suffix);
  if (requestedSkillId) {
    const requested = matches.find((skill) => skill.id === requestedSkillId);
    if (!requested) {
      throw new Error("Project Skill is not authorized for this Workflow node.");
    }
    return requested.id;
  }
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    throw new Error(
      "Workflow Skill ID is ambiguous. Save the original skillId in the node configuration."
    );
  }
  throw new Error("Project Skill is no longer available.");
}

async function executeMcp(
  options: ExecutorOptions,
  executorKey: string,
  input: Record<string, unknown>,
  localProjectId: string
): Promise<unknown> {
  const servers = await options.workerClient.listMcpServers();
  const match = servers.flatMap((server) =>
    server.tools.map((tool) => ({ server, tool }))
  ).find(({ server, tool }) =>
    `mcp__${sanitizeKey(server.serverId)}__${sanitizeKey(tool.name)}` === executorKey
  );
  if (
    !match ||
    (match.server.localProjectId &&
      match.server.localProjectId !== localProjectId)
  ) {
    throw new Error("MCP Tool is not authorized for this project.");
  }
  if (match.server.status !== "online") {
    await options.workerClient.startMcpServer(match.server.serverId);
  }
  const args = withoutRuntimeFields(input);
  return authorize(
    options,
    localProjectId,
    "local.mcp.call",
    "R2",
    `Allow Workflow to call MCP Tool ${match.tool.name}?`,
    `${match.server.name} / ${match.tool.name}`,
    `${match.server.serverId}:${match.tool.name}:${hash(JSON.stringify(args))}`,
    () => options.workerClient.callMcpTool(
      match.server.serverId,
      match.tool.name,
      args
    )
  );
}

async function executeBrowser(
  options: ExecutorOptions,
  executorKey: string,
  input: Record<string, unknown>,
  localProjectId: string,
  signal: AbortSignal
): Promise<unknown> {
  const browser = options.getBrowser();
  const pageId = optionalString(input, "pageId", 256);
  const operation = executorKey.slice("local.browser.".length);
  const risk: ToolRisk = operation === "upload"
    ? "R3"
    : operation === "click" || operation === "type"
      ? "R2"
      : "R1";
  const detail =
    operation === "navigate"
      ? requiredString(input, "url", 8_192)
      : operation === "screenshot"
        ? pageId ?? "active page"
        : requiredString(input, "selector", 2_048);
  return authorize(
    options,
    localProjectId,
    executorKey,
    risk,
    `Allow Workflow to ${operation} in Managed Browser?`,
    detail,
    `${pageId ?? "active"}:${detail}:${operation === "type" ? hash(requiredString(input, "text", 100_000, true)) : ""}`,
    async () => {
      throwIfAborted(signal);
      if (operation === "navigate") {
        return browser.navigate(localProjectId, detail, pageId, { source: "workflow" });
      }
      if (operation === "click") {
        await browser.click(localProjectId, detail, pageId, { source: "workflow" });
        return { completed: true };
      }
      if (operation === "type") {
        const text = requiredString(input, "text", 100_000, true);
        await browser.type(localProjectId, detail, text, pageId, { source: "workflow" });
        return { completed: true, characters: text.length };
      }
      if (operation === "upload") {
        const relativePaths = stringArray(input.relativePaths, "relativePaths");
        if (!relativePaths.length || relativePaths.length > 20) {
          throw new Error("relativePaths must contain between 1 and 20 project files.");
        }
        return browser.upload(
          localProjectId,
          detail,
          relativePaths,
          pageId,
          { source: "workflow" }
        );
      }
      if (operation === "extract") {
        return {
          text: await browser.extract(
            localProjectId,
            detail,
            pageId,
            { source: "workflow" }
          )
        };
      }
      if (operation === "screenshot") {
        return {
          dataUrl: await browser.screenshot(
            localProjectId,
            pageId,
            { source: "workflow" }
          )
        };
      }
      throw new Error(`Unsupported Managed Browser operation: ${operation}`);
    }
  );
}

function authorize<TResult>(
  options: ExecutorOptions,
  localProjectId: string,
  capability: string,
  risk: ToolRisk,
  title: string,
  detail: string,
  approvalKey: string,
  operation: () => Promise<TResult>
): Promise<TResult> {
  return options.toolBroker.run(
    {
      capability,
      risk,
      title,
      detail,
      auditDetail: capability,
      approvalKey,
      projectId: localProjectId
    },
    operation
  );
}

function pathInput(input: Record<string, unknown>): string {
  return requiredString(
    input,
    "relativePath",
    4_096,
    false,
    optionalString(input, "path", 4_096)
  );
}

function requiredString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  allowEmpty = false,
  fallback?: string
): string {
  const value = input[key] ?? fallback;
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    value.length > maxLength
  ) {
    throw new Error(`${key} must be a string of at most ${maxLength} characters.`);
  }
  return value;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${key} must be a string of at most ${maxLength} characters.`);
  }
  return value;
}

function stringArray(value: unknown, key: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    value.some((item) => typeof item !== "string" || item.length > 8_192)
  ) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return value;
}

function optionalStringArray(
  value: unknown,
  key: string,
  maxItems: number
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > maxItems ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !item.trim() ||
        item.length > 2_048
    )
  ) {
    throw new Error(`${key} must be an array of 1 to ${maxItems} strings.`);
  }
  return value;
}

function productPriceRecord(
  input: Record<string, unknown>
): ProductPriceRecord {
  const priceValue = input.priceValue;
  const currency = input.currency;
  return {
    productTitle: requiredString(input, "productTitle", 10_000),
    priceText: requiredString(input, "priceText", 1_000),
    priceValue:
      typeof priceValue === "number" && Number.isFinite(priceValue)
        ? priceValue
        : null,
    currency:
      typeof currency === "string" && currency.length <= 16
        ? currency
        : null,
    sourceUrl: requiredString(input, "sourceUrl", 8_192),
    capturedAt: requiredString(input, "capturedAt", 64)
  };
}

function withoutRuntimeFields(
  input: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !key.startsWith("$"))
  );
}

function sanitizeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isConnectorId(value: string): value is NativeAppConnectorId {
  return value === "vscode" || value === "excel" || value === "powerpoint";
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw Object.assign(new Error("Workflow run was canceled."), {
    name: "AbortError",
    code: "WORKFLOW_CANCELED"
  });
}
