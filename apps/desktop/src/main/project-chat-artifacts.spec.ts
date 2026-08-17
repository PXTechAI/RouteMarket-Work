import { describe, expect, it } from "vitest";
import { extractProjectOutputArtifacts } from "./project-chat-artifacts";

describe("project output artifact extraction", () => {
  it("converts standard output_files into project-bound artifacts", () => {
    expect(extractProjectOutputArtifacts("project_1", JSON.stringify({
      output_files: [{
        filename: "报告.xlsx",
        relative_path: "reports/报告.xlsx",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 4096,
        content_hash: "sha256:abc"
      }]
    }), "local.mcp.example")).toEqual([
      expect.objectContaining({
        kind: "file",
        relativePath: "reports/报告.xlsx",
        filename: "报告.xlsx",
        size: 4096,
        uri: "project://project_1/reports/%E6%8A%A5%E5%91%8A.xlsx",
        providerId: "local.mcp.example"
      })
    ]);
  });

  it("rejects failed results and paths outside the project", () => {
    expect(extractProjectOutputArtifacts("project_1", JSON.stringify({
      exit_code: 1,
      output_files: [{ relative_path: "report.xlsx" }]
    }), "test")).toEqual([]);
    expect(extractProjectOutputArtifacts("project_1", JSON.stringify({
      output_files: [{ relative_path: "../secret.txt" }]
    }), "test")).toEqual([]);
  });
});
