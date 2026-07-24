import { describe, expect, it } from "vitest";
import type { DesktopWorkflowNodeDefinition } from "../../../../shared/desktop-api";
import {
  AMAZON_PRICE_WORKFLOW_KEYS,
  createAmazonPriceWorkflowDraft,
  normalizeAmazonUrl
} from "./amazon-price-template";

describe("Amazon price workflow template", () => {
  it("creates a configured three-step browser-to-CSV workflow", () => {
    let sequence = 0;
    const draft = createAmazonPriceWorkflowDraft({
      localProjectId: "project_1",
      url: "https://www.amazon.com/dp/B000TEST#reviews",
      outputDirectory: "C:/Exports",
      fileName: "price.csv",
      definitions: AMAZON_PRICE_WORKFLOW_KEYS.map(definition),
      now: "2026-07-24T00:00:00.000Z",
      makeId: (prefix) => `${prefix}_${++sequence}`
    });

    expect(draft.nodes.map((node) => node.executorKey)).toEqual(
      AMAZON_PRICE_WORKFLOW_KEYS
    );
    expect(draft.sourceSkill).toEqual({
      id: "builtin.amazon-price-monitor",
      version: 1
    });
    expect(draft.nodes[0]?.config).toEqual({
      url: "https://www.amazon.com/dp/B000TEST"
    });
    expect(draft.nodes[1]?.config).toEqual({
      sourceUrl: "https://www.amazon.com/dp/B000TEST"
    });
    expect(draft.nodes[2]?.config).toEqual({
      outputDirectory: "C:/Exports",
      fileName: "price.csv"
    });
    expect(draft.edges).toHaveLength(2);
  });

  it("rejects non-Amazon and insecure URLs", () => {
    expect(() => normalizeAmazonUrl("http://amazon.com/dp/test")).toThrow(
      "HTTPS"
    );
    expect(() => normalizeAmazonUrl("https://example.com/product")).toThrow(
      "Amazon"
    );
  });
});

function definition(executorKey: string): DesktopWorkflowNodeDefinition {
  return {
    executorKey,
    definitionVersion: 1,
    source: "desktop_builtin",
    executionTarget: "desktop",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    requiredCapabilities: [executorKey],
    portability: "device_bound",
    definitionHash: `sha256:${"a".repeat(64)}`,
    title: executorKey,
    description: executorKey,
    available: true,
    blockedReason: null
  };
}
