import { open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";
import { loadProjectContext } from "./project-context";
import { createProjectIgnoreMatcher } from "./project-ignore";

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".next", ".turbo", ".vite", "build", "coverage", "dist",
  "node_modules", "out", "release"
]);
const MAX_FILE_BYTES = 512 * 1024;

export type ProjectSearchMatch = {
  relativePath: string;
  matchKind: "path" | "content";
  line: number | null;
  column: number | null;
  preview: string;
};

export type ProjectSearchResult = {
  query: string;
  matches: ProjectSearchMatch[];
  filesScanned: number;
  truncated: boolean;
};

export async function searchProject(
  registry: ProjectRegistry,
  localProjectId: string,
  queryValue: string,
  options: { maxResults?: number; maxFiles?: number } = {}
): Promise<ProjectSearchResult> {
  const query = queryValue.trim();
  if (!query || query.length > 256 || query.includes("\0")) {
    throw new WorkerError("TOOL_INPUT_INVALID", "Search query must contain 1 to 256 characters.");
  }
  const project = registry.get(localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");

  const maxResults = clamp(options.maxResults, 1, 500, 100);
  const maxFiles = clamp(options.maxFiles, 1, 20_000, 5_000);
  const needle = query.toLocaleLowerCase();
  const shouldIgnore = createProjectIgnoreMatcher(
    (await loadProjectContext(registry, localProjectId)).settings.ignore
  );
  const matches: ProjectSearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  async function scan(absoluteDirectory: string, relativeDirectory: string): Promise<void> {
    if (truncated) return;
    const directory = await opendir(absoluteDirectory);
    for await (const entry of directory) {
      if (truncated) break;
      if (entry.isSymbolicLink()) continue;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (shouldIgnore(relativePath)) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name.toLocaleLowerCase())) {
          await scan(join(absoluteDirectory, entry.name), relativePath);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (filesScanned >= maxFiles) {
        truncated = true;
        break;
      }
      filesScanned += 1;
      if (relativePath.toLocaleLowerCase().includes(needle)) {
        matches.push({
          relativePath,
          matchKind: "path",
          line: null,
          column: null,
          preview: relativePath
        });
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
      }

      const filePath = join(absoluteDirectory, entry.name);
      const handle = await open(filePath, "r").catch(() => null);
      if (!handle) continue;
      try {
        const stats = await handle.stat();
        if (stats.size > MAX_FILE_BYTES) continue;
        const buffer = Buffer.alloc(stats.size);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const content = buffer.subarray(0, bytesRead);
        if (content.includes(0)) continue;
        const lines = content.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const column = lines[index]!.toLocaleLowerCase().indexOf(needle);
          if (column < 0) continue;
          matches.push({
            relativePath,
            matchKind: "content",
            line: index + 1,
            column: column + 1,
            preview: lines[index]!.trim().slice(0, 240)
          });
          if (matches.length >= maxResults) {
            truncated = true;
            break;
          }
        }
      } finally {
        await handle.close();
      }
    }
  }

  await scan(project.realRootPath, "");
  return { query, matches, filesScanned, truncated };
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value as number)));
}
