import { tr } from "../../i18n";
import type { DesktopWorkflowDraft, DesktopWorkflowNodeDefinition } from "../../../../shared/desktop-api";
import type { WorkflowSkillDefinition } from "./workflow-skill-registry";
export const AMAZON_PRICE_WORKFLOW_KEYS = [
    "local.browser.navigate",
    "local.browser.product_extract",
    "local.data.csv_export"
] as const;
const AMAZON_PRICE_MONITOR_SKILL_ID = "builtin.amazon-price-monitor";
const AMAZON_PRICE_MONITOR_SKILL_VERSION = 1;

export function getAmazonPriceMonitorSkill(): WorkflowSkillDefinition { return {
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
            required: true
        },
        {
            key: "fileName",
            kind: "text",
            label: tr("ui.c903bdccd991"),
            placeholder: "amazon-product-price.csv",
            defaultValue: "amazon-product-price.csv",
            required: true
        },
        {
            key: "outputDirectory",
            kind: "directory",
            label: tr("ui.64414db65835"),
            required: true
        }
    ],
    createDraft(input) {
        return createAmazonPriceWorkflowDraft({
            localProjectId: input.localProjectId,
            definitions: input.definitions,
            url: input.values.url ?? "",
            outputDirectory: input.values.outputDirectory ?? "",
            fileName: input.values.fileName
        });
    }
}; }
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
    if (!outputDirectory)
        throw new Error(tr("ui.8eaf6ae039b4"));
    const definitions = AMAZON_PRICE_WORKFLOW_KEYS.map((key) => {
        const definition = input.definitions.find((candidate) => candidate.executorKey === key && candidate.available);
        if (!definition)
            throw new Error(tr("ui.bbfc3c9c0fba", [key]));
        return definition;
    });
    const makeId = input.makeId ??
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
        config: index === 0
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
        name: tr("ui.d5923e2788da"),
        sourceSkill: {
            id: AMAZON_PRICE_MONITOR_SKILL_ID,
            version: AMAZON_PRICE_MONITOR_SKILL_VERSION
        },
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
    }
    catch {
        throw new Error(tr("ui.ec66bdb5e4a3"));
    }
    if (parsed.protocol !== "https:") {
        throw new Error(tr("ui.ce53e99d7d01"));
    }
    const hostname = parsed.hostname.toLocaleLowerCase();
    if (!/^([a-z0-9-]+\.)*amazon\.[a-z.]+$/.test(hostname)) {
        throw new Error(tr("ui.5efd762c1406"));
    }
    parsed.hash = "";
    return parsed.toString();
}
