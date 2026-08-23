import { describe, expect, it } from "vitest";
import {
  resolveWorkflowParameterFields,
  validateWorkflowParameterConfig,
  withWorkflowParameterDefaults,
  type WorkflowParameterSchema,
} from "./workflow-node-config-schema";

describe("workflow node parameter schema", () => {
  it("renders a URL form for legacy navigate nodes without schema properties", () => {
    const fields = resolveWorkflowParameterFields(
      "local.browser.navigate",
      { type: "object" },
      { url: "https://example.com" },
    );

    expect(fields).toEqual([
      expect.objectContaining({ key: "url", required: true, schema: expect.objectContaining({ format: "uri" }) }),
    ]);
  });

  it("keeps upstream outputs out of the normal form", () => {
    const schema: WorkflowParameterSchema = {
      type: "object",
      properties: {
        workbookPath: { type: "string" },
        sheetName: { type: "string" },
        screenshotPath: { type: "string" },
        productTitle: { type: "string" },
      },
      required: ["workbookPath", "screenshotPath", "productTitle"],
    };

    expect(resolveWorkflowParameterFields("local.data.xlsx_append", schema, {}))
      .toEqual([
        expect.objectContaining({ key: "workbookPath", required: true }),
        expect.objectContaining({ key: "sheetName", required: false }),
      ]);
  });

  it("hydrates schema defaults and validates visible required fields", () => {
    const schema: WorkflowParameterSchema = {
      type: "object",
      properties: { intervalMinutes: { type: "integer", default: 10, minimum: 1 } },
      required: ["intervalMinutes"],
    };
    const config = withWorkflowParameterDefaults(schema, {});
    const fields = resolveWorkflowParameterFields("desktop.trigger.schedule", schema, config);

    expect(config).toEqual({ intervalMinutes: 10 });
    expect(validateWorkflowParameterConfig(fields, config)).toBeNull();
    expect(validateWorkflowParameterConfig(fields, { intervalMinutes: 0 })).toBe("intervalMinutes");
  });

  it("hides fixed and advanced-only schema fields from the normal form", () => {
    const schema: WorkflowParameterSchema = {
      type: "object",
      properties: {
        skillId: { type: "string", const: "review" },
        task: { type: "string" },
        pageId: { type: "string", "x-ui": { advanced: true } },
      },
    };

    expect(resolveWorkflowParameterFields("skill.local.review", schema, {}))
      .toEqual([expect.objectContaining({ key: "task" })]);
  });
});
