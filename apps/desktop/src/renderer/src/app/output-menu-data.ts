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
  selectedFilePath: string | null,
  recentSourcePaths: string[],
  limit = 3
): ProjectFileEntry[] {
  const flattened = flattenFiles(files?.entries ?? []);
  const filesByPath = new Map(flattened.map((entry) => [entry.relativePath, entry]));
  const priorityPaths = [...new Set([
    ...(selectedFilePath ? [selectedFilePath] : []),
    ...recentSourcePaths
  ])];
  const priorityEntries = priorityPaths.map((relativePath) => filesByPath.get(relativePath) ?? {
    name: filenameFromPath(relativePath),
    relativePath,
    kind: "file" as const
  });
  const prioritySet = new Set(priorityPaths);
  const remainingEntries = flattened
    .filter((entry) => !prioritySet.has(entry.relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return [...priorityEntries, ...remainingEntries].slice(0, limit);
}

export function sortOutputProcesses(processes: ManagedProcessSummary[]): ManagedProcessSummary[] {
  return [...processes].sort((left, right) =>
    Number(right.status === "running") - Number(left.status === "running") ||
    right.startedAt.localeCompare(left.startedAt));
}
