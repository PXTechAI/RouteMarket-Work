import type {
  DesktopWorkflowDraft,
  DesktopWorkflowNodeDefinition
} from "../../../../shared/desktop-api";

export const AMAZON_PRICE_WORKFLOW_KEYS = [
  "local.browser.navigate",
  "local.browser.product_extract",
  "local.data.csv_export"
] as const;

export function createAmazonPriceWorkflowDraft(input: {
  localProjectId: string;
  url: string;
  outputDirectory: string;
  fileName?: string;
  definitions: DesktopWorkflowNodeDefinition[];
  now?: string;
  makeId?: (prefix: string) => string;
}): DesktopWorkflowDraft {
  const url = normalizeAmazonUrl(input.url);
  const outputDirectory = input.outputDirectory.trim();
  if (!outputDirectory) throw new Error("请选择表格保存目录。");
  const definitions = AMAZON_PRICE_WORKFLOW_KEYS.map((key) => {
    const definition = input.definitions.find(
      (candidate) => candidate.executorKey === key && candidate.available
    );
    if (!definition) throw new Error(`当前设备缺少工作流节点：${key}`);
    return definition;
  });
  const makeId =
    input.makeId ??
    ((prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  const now = input.now ?? new Date().toISOString();
  const nodeIds = definitions.map(() => makeId("node"));
  const nodes = definitions.map((definition, index) => ({
    nodeId: nodeIds[index]!,
    executorKey: definition.executorKey,
    title: definition.title,
    executionTarget: definition.executionTarget,
    x: 70 + index * 270,
    y: 110,
    config:
      index === 0
        ? { url }
        : index === 1
          ? { sourceUrl: url }
          : {
              outputDirectory,
              fileName: input.fileName?.trim() || "amazon-product-price.csv"
            },
    definitionSnapshot: definition
  }));
  return {
    workflowId: makeId("workflow"),
    localProjectId: input.localProjectId,
    kind: "workflow",
    name: "Amazon 单品价格采集",
    nodes,
    edges: [
      {
        edgeId: makeId("edge"),
        sourceNodeId: nodeIds[0]!,
        targetNodeId: nodeIds[1]!
      },
      {
        edgeId: makeId("edge"),
        sourceNodeId: nodeIds[1]!,
        targetNodeId: nodeIds[2]!
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeAmazonUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("请输入完整的 Amazon 商品链接。");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Amazon 商品链接必须使用 HTTPS。");
  }
  const hostname = parsed.hostname.toLocaleLowerCase();
  if (!/^([a-z0-9-]+\.)*amazon\.[a-z.]+$/.test(hostname)) {
    throw new Error("当前模板只接受 Amazon 域名下的商品链接。");
  }
  parsed.hash = "";
  return parsed.toString();
}
