import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../../../../shared/desktop-api";
import {
  projectFolderAvailable,
  projectFolderLabel,
  projectFolderMessage,
  projectFolderStatus
} from "./project-folder-status";

const project = (folderStatus?: ProjectSummary["folderStatus"], hasFolder = true): ProjectSummary => ({
  localProjectId: "project_1",
  displayName: "Project",
  hasFolder,
  ...(folderStatus ? { folderStatus } : {}),
  rootFingerprint: "",
  createdAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T00:00:00.000Z"
});

describe("project folder status", () => {
  it("keeps compatibility with project summaries created before health checks", () => {
    expect(projectFolderStatus(project(undefined, false))).toBe("unlinked");
    expect(projectFolderStatus(project())).toBe("available");
  });

  it("only enables local file capabilities for an available folder", () => {
    expect(projectFolderAvailable(project("available"))).toBe(true);
    expect(projectFolderAvailable(project("missing"))).toBe(false);
    expect(projectFolderAvailable(project("unavailable"))).toBe(false);
  });

  it("provides actionable missing and unavailable copy", () => {
    expect(projectFolderLabel(project("missing"))).toBe("文件夹丢失");
    expect(projectFolderMessage(project("unavailable"))).toContain("权限");
  });
});
