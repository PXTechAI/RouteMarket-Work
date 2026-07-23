import type { ProjectSummary } from "../../../../shared/desktop-api";

export type ProjectFolderStatus = NonNullable<ProjectSummary["folderStatus"]>;

export function projectFolderStatus(project: ProjectSummary | null | undefined): ProjectFolderStatus {
  if (!project) return "unlinked";
  return project.folderStatus ?? (project.hasFolder === false ? "unlinked" : "available");
}

export function projectFolderAvailable(project: ProjectSummary | null | undefined): boolean {
  return projectFolderStatus(project) === "available";
}

export function projectFolderLabel(project: ProjectSummary | null | undefined): string {
  const status = projectFolderStatus(project);
  if (status === "available") return "本机";
  if (status === "missing") return "文件夹丢失";
  if (status === "unavailable") return "无法访问";
  return "未关联";
}

export function projectFolderMessage(project: ProjectSummary | null | undefined): string {
  const status = projectFolderStatus(project);
  if (status === "available") return "已关联本机文件夹";
  if (status === "missing") return "原文件夹已移动或不存在，请重新关联";
  if (status === "unavailable") return "原文件夹当前无法访问，请检查权限或重新关联";
  return "未关联文件夹";
}
