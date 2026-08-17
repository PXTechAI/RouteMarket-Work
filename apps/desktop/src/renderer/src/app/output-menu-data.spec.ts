import { describe, expect, it } from "vitest";
import type { ManagedProcessSummary, ProjectFileTree } from "../../../shared/desktop-api";
import { buildOutputSources, sortOutputProcesses } from "./output-menu-data";

const tree: ProjectFileTree = {
  entries: [
    { name: "src", relativePath: "src", kind: "directory", children: [
      { name: "App.tsx", relativePath: "src/App.tsx", kind: "file" }
    ] },
    { name: "README.md", relativePath: "README.md", kind: "file" }
  ],
  totalEntries: 3,
  truncated: false
};

function process(processId: string, status: ManagedProcessSummary["status"], startedAt: string): ManagedProcessSummary {
  return {
    processId,
    localProjectId: "project_1",
    executable: "node",
    args: [],
    status,
    pid: null,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    outputTruncated: false,
    startedAt,
    finishedAt: null
  };
}

describe("output menu data", () => {
  it("shows a newly generated chat artifact before the file tree refreshes", () => {
    expect(buildOutputSources(tree, null, ["reports/new.xlsx"]).map((entry) => entry.relativePath))
      .toEqual(["reports/new.xlsx", "README.md", "src/App.tsx"]);
  });

  it("keeps the selected file first and removes duplicate recent sources", () => {
    expect(buildOutputSources(tree, "src/App.tsx", ["README.md", "src/App.tsx"]).map((entry) => entry.relativePath))
      .toEqual(["src/App.tsx", "README.md"]);
  });

  it("puts running and newer processes first without mutating the input", () => {
    const input = [
      process("old-running", "running", "2026-01-01T00:00:00.000Z"),
      process("new-stopped", "stopped", "2026-03-01T00:00:00.000Z"),
      process("new-running", "running", "2026-02-01T00:00:00.000Z")
    ];
    expect(sortOutputProcesses(input).map((item) => item.processId))
      .toEqual(["new-running", "old-running", "new-stopped"]);
    expect(input.map((item) => item.processId))
      .toEqual(["old-running", "new-stopped", "new-running"]);
  });
});
