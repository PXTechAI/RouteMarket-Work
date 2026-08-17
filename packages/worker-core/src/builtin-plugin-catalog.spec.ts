import { describe, expect, it } from "vitest";
import { buildBuiltinPluginCatalog, findBuiltinPlugin } from "./builtin-plugin-catalog";

describe("built-in plugin catalog", () => {
  it("separates the available Browser host runtime from planned document plugins", () => {
    const catalog = buildBuiltinPluginCatalog();
    expect(catalog.revisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(catalog.plugins.map(({ id, kind, status }) => ({ id, kind, status }))).toEqual([
      { id: "ai.routemarket.browser", kind: "host_runtime", status: "available" },
      { id: "ai.routemarket.pdf", kind: "declarative_plugin", status: "available" },
      { id: "ai.routemarket.spreadsheet", kind: "declarative_plugin", status: "available" }
    ]);
  });

  it("declares document viewers separately from tools and native connectors", () => {
    const spreadsheet = findBuiltinPlugin("ai.routemarket.spreadsheet");
    expect(spreadsheet?.contributes.viewers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "spreadsheet.viewer",
        extensions: [".xlsx", ".csv", ".tsv"],
        status: "available",
        mode: "readonly"
      })
    ]));
    expect(spreadsheet?.contributes.viewers).toContainEqual(expect.objectContaining({
      id: "spreadsheet.legacy-viewer",
      extensions: [".xls"],
      status: "planned"
    }));
    expect(spreadsheet?.contributes.tools).toHaveLength(1);
    expect(spreadsheet?.contributes.tools).toContainEqual(expect.objectContaining({
      name: "spreadsheet",
      status: "available"
    }));
    expect(spreadsheet?.activationEvents).toContain("onTool:spreadsheet");
    expect(spreadsheet?.contributes.connectors).toEqual([
      expect.objectContaining({ id: "spreadsheet.microsoft-excel", kind: "native_app" })
    ]);
  });

  it("returns fresh manifests so consumers cannot mutate the shared catalog", () => {
    const first = buildBuiltinPluginCatalog();
    first.plugins[0]!.name = "Changed";
    expect(buildBuiltinPluginCatalog().plugins[0]!.name).not.toBe("Changed");
  });

  it("keeps Browser operations behind the host runtime", () => {
    const browser = findBuiltinPlugin("ai.routemarket.browser");
    expect(browser).toEqual(expect.objectContaining({
      kind: "host_runtime",
      status: "available"
    }));
    expect(browser?.contributes.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "browser_extract", risk: "R0" }),
      expect.objectContaining({ name: "browser_click", risk: "R2" }),
      expect.objectContaining({ name: "browser_upload", risk: "R3" })
    ]));
  });
});
