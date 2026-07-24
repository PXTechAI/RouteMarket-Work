import { describe, expect, it } from "vitest";
import { buildDesktopWorkflowNodeRegistry } from "./workflow-node-registry";

describe("buildDesktopWorkflowNodeRegistry", () => {
  it("combines stable built-ins, live MCP tools and runnable project Skills", () => {
    const generatedAt = "2026-07-18T00:00:00.000Z";
    const registry = buildDesktopWorkflowNodeRegistry({
      generatedAt,
      mcpServers: [{
        serverId: "mcp_excel",
        name: "Excel",
        transport: "stdio",
        command: "excel-mcp",
        args: [],
        url: null,
        localProjectId: null,
        enabled: true,
        createdAt: generatedAt,
        updatedAt: generatedAt,
        status: "online",
        tools: [{ name: "write_cells", inputSchema: { type: "object" } }],
        serverInfo: { name: "excel", version: "1" },
        protocolVersion: "2025-11-25",
        stderr: "",
        lastError: null
      }],
      skills: [{
        id: "review",
        name: "Review",
        description: "Review changes",
        relativePath: ".routemarket/skills/review/SKILL.md"
      }]
    });
    expect(registry.revisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(registry.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ executorKey: "local.fs.read", available: true }),
      expect.objectContaining({
        executorKey: "local.browser.product_extract",
        title: "识别 Amazon 商品",
        available: true
      }),
      expect.objectContaining({
        executorKey: "local.data.csv_export",
        title: "导出商品价格表",
        available: true
      }),
      expect.objectContaining({
        executorKey: "mcp__mcp_excel__write_cells",
        portability: "requires_connector",
        available: true
      }),
      expect.objectContaining({
        executorKey: "skill.local.review",
        available: true,
        blockedReason: null,
        requiredCapabilities: ["local.skill.invoke"],
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            skillId: expect.objectContaining({ const: "review" }),
            task: expect.objectContaining({ type: "string" })
          })
        })
      })
    ]));
    expect(registry.definitions.every((definition) =>
      /^sha256:[a-f0-9]{64}$/.test(definition.definitionHash)
    )).toBe(true);
  });

  it("produces the same hashes regardless of generation time", () => {
    const first = buildDesktopWorkflowNodeRegistry({ mcpServers: [], skills: [], generatedAt: "a" });
    const second = buildDesktopWorkflowNodeRegistry({ mcpServers: [], skills: [], generatedAt: "b" });
    expect(first.revisionHash).toBe(second.revisionHash);
  });
});
