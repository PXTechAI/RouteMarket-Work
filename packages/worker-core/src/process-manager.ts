import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { terminateProcessTree } from "./child-process";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";

const MAX_OUTPUT_BYTES = 128 * 1024;
const SENSITIVE_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTH)/i;

export type ManagedProcessStatus = "running" | "exited" | "failed" | "stopped";

export type ManagedProcessSummary = {
  processId: string;
  localProjectId: string;
  executable: string;
  args: string[];
  status: ManagedProcessStatus;
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  startedAt: string;
  finishedAt: string | null;
};

type ManagedEntry = ManagedProcessSummary & { child: ChildProcessWithoutNullStreams | null };

export class ControlledProcessManager {
  private readonly entries = new Map<string, ManagedEntry>();

  constructor(private readonly registry: ProjectRegistry) {}

  start(input: {
    localProjectId: string;
    executable: string;
    args?: string[];
  }): ManagedProcessSummary {
    const project = this.registry.get(input.localProjectId);
    if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
    const executable = input.executable.trim();
    const args = input.args ?? [];
    if (!executable || executable.length > 1024 || executable.includes("\0")) {
      throw new WorkerError("TOOL_INPUT_INVALID", "Executable is invalid.");
    }
    if (args.length > 256 || args.some((arg) => arg.length > 8_192 || arg.includes("\0"))) {
      throw new WorkerError("TOOL_INPUT_INVALID", "Process arguments exceed safety limits.");
    }

    const processId = `process_${randomUUID().replaceAll("-", "")}`;
    const startedAt = new Date().toISOString();
    const child = spawn(executable, args, {
      cwd: project.realRootPath,
      env: sanitizedEnvironment(),
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const entry: ManagedEntry = {
      processId,
      localProjectId: input.localProjectId,
      executable,
      args: [...args],
      status: "running",
      pid: child.pid ?? null,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      startedAt,
      finishedAt: null,
      child
    };
    this.entries.set(processId, entry);
    child.stdout.on("data", (chunk: Buffer) => appendOutput(entry, "stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput(entry, "stderr", chunk));
    child.on("error", (error) => {
      entry.status = "failed";
      entry.stderr = appendBounded(entry.stderr, error.message, entry);
      entry.finishedAt = new Date().toISOString();
      entry.child = null;
    });
    child.on("exit", (code, signal) => {
      if (entry.status === "running") entry.status = "exited";
      entry.exitCode = code;
      entry.signal = signal;
      entry.finishedAt = new Date().toISOString();
      entry.child = null;
    });
    return summarize(entry);
  }

  list(): ManagedProcessSummary[] {
    return [...this.entries.values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map(summarize);
  }

  get(processId: string): ManagedProcessSummary {
    const entry = this.entries.get(processId);
    if (!entry) throw new WorkerError("PROCESS_NOT_FOUND", "Managed process was not found.");
    return summarize(entry);
  }

  async stop(processId: string): Promise<ManagedProcessSummary> {
    const entry = this.entries.get(processId);
    if (!entry) throw new WorkerError("PROCESS_NOT_FOUND", "Managed process was not found.");
    if (!entry.child || entry.status !== "running") return summarize(entry);
    entry.status = "stopped";
    await terminateProcessTree(entry.child);
    return summarize(entry);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      [...this.entries.values()]
        .filter((entry) => entry.status === "running")
        .map((entry) => this.stop(entry.processId))
    );
  }
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => value !== undefined && !SENSITIVE_ENV.test(name))
  );
}

function appendOutput(entry: ManagedEntry, stream: "stdout" | "stderr", chunk: Buffer): void {
  entry[stream] = appendBounded(entry[stream], chunk.toString("utf8"), entry);
}

function appendBounded(current: string, addition: string, entry: ManagedEntry): string {
  const combined = current + addition;
  const buffer = Buffer.from(combined, "utf8");
  if (buffer.byteLength <= MAX_OUTPUT_BYTES) return combined;
  entry.outputTruncated = true;
  return buffer.subarray(buffer.byteLength - MAX_OUTPUT_BYTES).toString("utf8");
}

function summarize(entry: ManagedEntry): ManagedProcessSummary {
  const { child: _child, ...summary } = entry;
  return { ...summary, args: [...summary.args] };
}
