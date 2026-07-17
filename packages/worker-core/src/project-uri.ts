import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { LocalProject } from "./project-registry";
import { WorkerError } from "./errors";

export type ParsedProjectUri = {
  localProjectId: string;
  relativePath: string;
};

export function parseProjectUri(uri: string): ParsedProjectUri {
  if (uri.includes("\0")) {
    throw new WorkerError("PROJECT_URI_INVALID", "Project URI contains a NUL byte.");
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new WorkerError("PROJECT_URI_INVALID", "Project URI is malformed.");
  }
  if (parsed.protocol !== "project:" || !parsed.hostname) {
    throw new WorkerError("PROJECT_URI_INVALID", "Only project:// URIs are allowed.");
  }
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new WorkerError("PROJECT_URI_INVALID", "Project URI contains unsupported components.");
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new WorkerError("PROJECT_URI_INVALID", "Project URI contains invalid encoding.");
  }
  if (!relativePath || relativePath.includes("\0") || isAbsolute(relativePath)) {
    throw new WorkerError("PROJECT_URI_INVALID", "Project URI must contain a relative file path.");
  }
  if (
    relativePath.split(/[\\/]+/).some((part) => part === "..") ||
    /^[a-zA-Z]:/.test(relativePath) ||
    relativePath.startsWith("\\\\") ||
    relativePath.startsWith("\\\\?\\")
  ) {
    throw new WorkerError("PROJECT_PATH_ESCAPE", "Project path attempts to escape its root.");
  }

  return {
    localProjectId: parsed.hostname,
    relativePath
  };
}

export async function resolveProjectFile(project: LocalProject, relativePath: string): Promise<string> {
  const candidate = resolve(project.realRootPath, relativePath);
  assertWithinRoot(project.realRootPath, candidate);

  const realCandidate = await realpath(candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new WorkerError("PROJECT_FILE_NOT_FOUND", "Requested project file does not exist.");
    }
    throw error;
  });
  assertWithinRoot(project.realRootPath, realCandidate);
  return realCandidate;
}

function assertWithinRoot(rootPath: string, candidatePath: string): void {
  const pathFromRoot = relative(rootPath, candidatePath);
  if (pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))) {
    return;
  }
  throw new WorkerError("PROJECT_PATH_ESCAPE", "Resolved path is outside the project root.");
}
