import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";

export type ProjectFileEntry = {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  children?: ProjectFileEntry[];
};

export type ProjectFileTree = {
  entries: ProjectFileEntry[];
  totalEntries: number;
  truncated: boolean;
};

export type ProjectFileListOptions = {
  maxDepth?: number;
  maxEntries?: number;
};

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "release"
]);

export async function listProjectFiles(
  registry: ProjectRegistry,
  localProjectId: string,
  options: ProjectFileListOptions = {}
): Promise<ProjectFileTree> {
  const project = registry.get(localProjectId);
  if (!project) {
    throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  }

  const maxDepth = clampInteger(options.maxDepth, 1, 12, 6);
  const maxEntries = clampInteger(options.maxEntries, 1, 10_000, 1_500);
  let totalEntries = 0;
  let truncated = false;

  async function scanDirectory(
    absolutePath: string,
    relativeDirectory: string,
    depth: number
  ): Promise<ProjectFileEntry[]> {
    const entries: ProjectFileEntry[] = [];
    let directory;
    try {
      directory = await opendir(absolutePath);
    } catch (error) {
      if (relativeDirectory) return entries;
      throw error;
    }

    for await (const dirent of directory) {
      if (truncated) break;
      if (dirent.isSymbolicLink()) continue;
      if (!dirent.isDirectory() && !dirent.isFile()) continue;
      if (dirent.isDirectory() && EXCLUDED_DIRECTORIES.has(dirent.name.toLowerCase())) {
        continue;
      }
      if (totalEntries >= maxEntries) {
        truncated = true;
        break;
      }

      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${dirent.name}`
        : dirent.name;
      totalEntries += 1;

      if (dirent.isDirectory()) {
        const children = depth < maxDepth
          ? await scanDirectory(join(absolutePath, dirent.name), relativePath, depth + 1)
          : [];
        entries.push({
          name: dirent.name,
          relativePath,
          kind: "directory",
          children
        });
      } else {
        entries.push({
          name: dirent.name,
          relativePath,
          kind: "file"
        });
      }
    }

    return entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
  }

  return {
    entries: await scanDirectory(project.realRootPath, "", 0),
    totalEntries,
    truncated
  };
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value as number)));
}
