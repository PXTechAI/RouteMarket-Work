import { tr } from "../../i18n";
import type { DesktopWorkflowDraft, DesktopWorkflowNodeDefinition } from "../../../../shared/desktop-api";
import type { WorkflowSkillDefinition } from "./workflow-skill-registry";

export const AMAZON_PRICE_WORKFLOW_KEYS = [
  "local.browser.navigate",
  "local.browser.product_extract",
  "local.browser.screenshot_save",
  "local.data.xlsx_append",
  "local.browser.qq_mail_send",
] as const;

const AMAZON_PRICE_MONITOR_SKILL_ID = "builtin.amazon-price-monitor";
const AMAZON_PRICE_MONITOR_SKILL_VERSION = 2;

export function getAmazonPriceMonitorSkill(): WorkflowSkillDefinition {
  return {
    id: AMAZON_PRICE_MONITOR_SKILL_ID,
    version: AMAZON_PRICE_MONITOR_SKILL_VERSION,
    name: tr("ui.faff69e76244"),
    description: tr("ui.3dfff09064e6"),
    requiredExecutorKeys: [...AMAZON_PRICE_WORKFLOW_KEYS],
    setupFields: [
      {
        key: "url",
        kind: "url",
        label: tr("ui.0bf014430dbe"),
        placeholder: "https://www.amazon.com/dp/...",
        defaultValue: "https://www.amazon.com/Belkin-USB-Charger-Block-45W/dp/B0F6431LKG",
        required: true,
      },
      {
        key: "workbookPath",
        kind: "text",
        label: "项目内 Excel 路径",
        placeholder: "outputs/amazon-price-monitor/amazon-price-history.xlsx",
        defaultValue: "outputs/amazon-price-monitor/amazon-price-history.xlsx",
        required: true,
      },
      {
        key: "screenshotsDirectory",
        kind: "text",
        label: "项目内截图目录",
        placeholder: "outputs/amazon-price-monitor/screenshots",
        defaultValue: "outputs/amazon-price-monitor/screenshots",
        required: true,
      },
      {
        key: "recipient",
        kind: "text",
        label: "收件人",
        placeholder: "lizhug.steven@gmail.com",
        defaultValue: "lizhug.steven@gmail.com",
        required: true,
      },
      {
        key: "intervalMinutes",
        kind: "text",
        label: "测试间隔（分钟）",
        placeholder: "10",
        defaultValue: "10",
        required: true,
      },
    ],
    createDraft(input) {
      return createAmazonPriceWorkflowDraft({
        localProjectId: input.localProjectId,
        definitions: input.definitions,
        url: input.values.url ?? "",
        workbookPath: input.values.workbookPath,
        screenshotsDirectory: input.values.screenshotsDirectory,
        recipient: input.values.recipient,
      });
    },
    createTrigger(input) {
      const intervalMinutes = Number(input.values.intervalMinutes);
      if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 525_600) {
        throw new Error("计划任务间隔必须在 1 到 525600 分钟之间。");
      }
      return {
        localProjectId: input.localProjectId,
        workflowId: input.draft.workflowId,
        name: `${input.draft.name} · 每 ${intervalMinutes} 分钟`,
        kind: "schedule",
        enabled: false,
        intervalMinutes,
      };
    },
  };
}

export function createAmazonPriceWorkflowDraft(input: {
  localProjectId: string;
  url: string;
  workbookPath?: string;
  screenshotsDirectory?: string;
  recipient?: string;
  definitions: DesktopWorkflowNodeDefinition[];
  now?: string;
  makeId?: (prefix: string) => string;
}): DesktopWorkflowDraft {
  const url = normalizeAmazonUrl(input.url);
  const workbookPath = normalizeProjectPath(
    input.workbookPath ?? "outputs/amazon-price-monitor/amazon-price-history.xlsx",
    ".xlsx",
  );
  const screenshotsDirectory = normalizeProjectPath(
    input.screenshotsDirectory ?? "outputs/amazon-price-monitor/screenshots",
  );
  const recipient = normalizeEmail(input.recipient ?? "lizhug.steven@gmail.com");
  const definitions = AMAZON_PRICE_WORKFLOW_KEYS.map((key) => {
    const definition = input.definitions.find((candidate) => candidate.executorKey === key && candidate.available);
    if (!definition) throw new Error(tr("ui.bbfc3c9c0fba", [key]));
    return definition;
  });
  const makeId = input.makeId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  const now = input.now ?? new Date().toISOString();
  const nodeIds = definitions.map(() => makeId("node"));
  const configs: Array<Record<string, unknown>> = [
    { url },
    { sourceUrl: url },
    { screenshotsDirectory },
    { workbookPath, sheetName: "Price History" },
    { recipient },
  ];
  const nodes = definitions.map((definition, index) => ({
    nodeId: nodeIds[index]!,
    executorKey: definition.executorKey,
    title: definition.title,
    executionTarget: definition.executionTarget,
    x: 70 + index * 270,
    y: 110,
    config: configs[index]!,
    definitionSnapshot: definition,
  }));
  return {
    workflowId: makeId("workflow"),
    localProjectId: input.localProjectId,
    kind: "workflow",
    name: tr("ui.d5923e2788da"),
    sourceSkill: {
      id: AMAZON_PRICE_MONITOR_SKILL_ID,
      version: AMAZON_PRICE_MONITOR_SKILL_VERSION,
    },
    nodes,
    edges: nodeIds.slice(0, -1).map((sourceNodeId, index) => ({
      edgeId: makeId("edge"),
      sourceNodeId,
      targetNodeId: nodeIds[index + 1]!,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeAmazonUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(tr("ui.ec66bdb5e4a3"));
  }
  if (parsed.protocol !== "https:") throw new Error(tr("ui.ce53e99d7d01"));
  const hostname = parsed.hostname.toLocaleLowerCase();
  if (!/^([a-z0-9-]+\.)*amazon\.[a-z.]+$/.test(hostname)) {
    throw new Error(tr("ui.5efd762c1406"));
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeProjectPath(value: string, extension?: string): string {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || /^[A-Za-z]:\//.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error("输出路径必须位于当前项目内。");
  }
  if (extension && !path.toLowerCase().endsWith(extension)) {
    throw new Error(`输出文件必须以 ${extension} 结尾。`);
  }
  return path;
}

function normalizeEmail(value: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error("请输入有效的收件人邮箱地址。");
  }
  return email;
}
