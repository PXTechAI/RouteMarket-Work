import type { ManagedProcessSummary, ProjectFileEntry, ProjectFileTree } from "../../../shared/desktop-api";

function flattenFiles(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return entries.flatMap((entry) => entry.kind === "file"
    ? [entry]
    : flattenFiles(entry.children ?? []));
}

function filenameFromPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? relativePath;
}

export function buildOutputSources(
  files: ProjectFileTree | null,
  conversationSourcePaths: string[],
  limit = 3
): ProjectFileEntry[] {
  const flattened = flattenFiles(files?.entries ?? []);
  const filesByPath = new Map(flattened.map((entry) => [entry.relativePath, entry]));
  return [...new Set(conversationSourcePaths)].slice(0, limit).map((relativePath) => filesByPath.get(relativePath) ?? {
    name: filenameFromPath(relativePath),
    relativePath,
    kind: "file" as const
  });
}

export function buildConversationFileTree(
  files: ProjectFileTree | null,
  conversationSourcePaths: string[]
): ProjectFileTree {
  const entries = buildOutputSources(files, conversationSourcePaths, Number.POSITIVE_INFINITY);
  return {
    entries,
    totalEntries: entries.length,
    truncated: false
  };
}

export function sortOutputProcesses(processes: ManagedProcessSummary[]): ManagedProcessSummary[] {
  return [...processes].sort((left, right) =>
    Number(right.status === "running") - Number(left.status === "running") ||
    right.startedAt.localeCompare(left.startedAt));
}
