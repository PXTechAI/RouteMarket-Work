import { createHash, randomUUID } from "node:crypto";
import { link, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WorkerError } from "./errors";
import type { LocalFsReadResult } from "./local-fs-read";
import { ProjectRegistry } from "./project-registry";
import { parseProjectUri, resolveNewProjectFile } from "./project-uri";

const MAX_CREATE_BYTES = 262_144;

export type LocalFsCreateResult = LocalFsReadResult & { created: true };

export async function createLocalProjectFile(
  registry: ProjectRegistry,
  input: { localProjectId: string; relativePath: string; text: string }
): Promise<LocalFsCreateResult> {
  const uriPath = input.relativePath
    .split(/[\\/]+/)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const uri = `project://${input.localProjectId}/${uriPath}`;
  const parsed = parseProjectUri(uri);
  const project = registry.get(parsed.localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  const bytes = Buffer.byteLength(input.text, "utf8");
  if (bytes > MAX_CREATE_BYTES) {
    throw new WorkerError("TOOL_OUTPUT_TOO_LARGE", "New files cannot exceed 256 KiB.");
  }

  const target = await resolveNewProjectFile(project, parsed.relativePath);
  const temporaryPath = join(dirname(target), `.routemarket-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(input.text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        throw new WorkerError("PROJECT_FILE_EXISTS", "The project file already exists.");
      }
      throw error;
    });
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }

  return {
    uri,
    text: input.text,
    bytesRead: bytes,
    truncated: false,
    encoding: "utf8",
    sha256: `sha256:${createHash("sha256").update(input.text).digest("hex")}`,
    created: true
  };
}
