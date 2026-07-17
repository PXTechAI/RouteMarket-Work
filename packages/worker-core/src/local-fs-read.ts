import { open } from "node:fs/promises";
import type { DesktopJob } from "@routemarket/work-protocol";
import { assertDesktopJob } from "@routemarket/work-protocol";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";
import { parseProjectUri, resolveProjectFile } from "./project-uri";

export type LocalFsReadResult = {
  uri: string;
  text: string;
  bytesRead: number;
  truncated: boolean;
  encoding: "utf8";
};

export async function executeLocalFsRead(
  registry: ProjectRegistry,
  jobValue: unknown
): Promise<LocalFsReadResult> {
  assertDesktopJob(jobValue);
  const job: DesktopJob = jobValue;
  if (job.executorKey !== "local.fs.read") {
    throw new WorkerError("CAPABILITY_UNSUPPORTED", `Unsupported executor: ${job.executorKey}`);
  }

  const parsed = parseProjectUri(job.input.uri);
  const project = registry.get(parsed.localProjectId);
  if (!project) {
    throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  }
  if (job.projectBindingId.length < 8) {
    throw new WorkerError("PROJECT_BINDING_INVALID", "Project binding is invalid.");
  }

  const filePath = await resolveProjectFile(project, parsed.relativePath);
  const maxBytes = Math.min(job.input.maxBytes ?? 65_536, job.maxInlineResultBytes, 262_144);
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const truncated = bytesRead > maxBytes;
    const resultBuffer = buffer.subarray(0, Math.min(bytesRead, maxBytes));
    return {
      uri: job.input.uri,
      text: resultBuffer.toString("utf8"),
      bytesRead: resultBuffer.byteLength,
      truncated,
      encoding: "utf8"
    };
  } finally {
    await handle.close();
  }
}
