import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WorkerError } from "./errors";
import { executeLocalFsRead, type LocalFsReadResult } from "./local-fs-read";
import { projectBindingIdFor } from "./project-binding";
import { ProjectRegistry } from "./project-registry";
import { parseProjectUri, resolveProjectFile } from "./project-uri";

const MAX_WRITE_BYTES = 262_144;

export type LocalFsWriteResult = LocalFsReadResult & {
  changed: boolean;
  previousSha256: string;
};

export async function writeLocalProjectFile(
  registry: ProjectRegistry,
  input: {
    localProjectId: string;
    relativePath: string;
    text: string;
    expectedSha256: string;
  }
): Promise<LocalFsWriteResult> {
  const uriPath = input.relativePath
    .split(/[\\/]+/)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const uri = `project://${input.localProjectId}/${uriPath}`;
  const parsed = parseProjectUri(uri);
  const project = registry.get(parsed.localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");

  const bytes = Buffer.byteLength(input.text, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new WorkerError("TOOL_OUTPUT_TOO_LARGE", "Edited files cannot exceed 256 KiB.");
  }

  const current = await executeLocalFsRead(registry, {
    jobId: "djob_local_write_preview",
    runtimeId: "runtime_local_preview",
    projectBindingId: projectBindingIdFor(input.localProjectId),
    executorKey: "local.fs.read",
    executorVersion: 1,
    input: { uri, maxBytes: MAX_WRITE_BYTES },
    requiredCapabilities: ["local.fs.read"],
    executionClass: "pure_read",
    approvalPolicy: { risk: "R0", mode: "project_grant" },
    idempotencyKey: `sha256:${createHash("sha256").update(uri).digest("hex")}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxInlineResultBytes: MAX_WRITE_BYTES
  });
  if (current.truncated) {
    throw new WorkerError("TOOL_OUTPUT_TOO_LARGE", "The file is too large for safe editing.");
  }
  if (current.sha256 !== input.expectedSha256) {
    throw new WorkerError(
      "PROJECT_FILE_CONFLICT",
      "The file changed on disk. Reload it before saving your edits."
    );
  }
  if (current.text === input.text) {
    return { ...current, changed: false, previousSha256: current.sha256 };
  }

  const filePath = await resolveProjectFile(project, parsed.relativePath);
  const temporaryPath = join(dirname(filePath), `.routemarket-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, input.text, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }

  const sha256 = `sha256:${createHash("sha256").update(input.text).digest("hex")}`;
  return {
    uri,
    text: input.text,
    bytesRead: bytes,
    truncated: false,
    encoding: "utf8",
    sha256,
    changed: true,
    previousSha256: current.sha256
  };
}
