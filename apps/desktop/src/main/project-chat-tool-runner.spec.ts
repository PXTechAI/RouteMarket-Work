import { describe, expect, it, vi } from "vitest";
import type { ManagedProcessSummary } from "../shared/desktop-api";
import { LocalToolBroker } from "./tool-broker";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";

const projectProcess: ManagedProcessSummary = {
  processId: "process_1",
  localProjectId: "project_1",
  executable: "pnpm",
  args: ["test"],
  status: "exited",
  pid: 123,
  exitCode: 0,
  signal: null,
  stdout: "Tests passed",
  stderr: "",
  outputTruncated: false,
  startedAt: "2026-07-18T07:00:00.000Z",
  finishedAt: "2026-07-18T07:00:01.000Z"
};

function createWorker() {
  return {
    listProjectFiles: vi.fn(async () => ({
      entries: [{
        name: "src",
        relativePath: "src",
        kind: "directory" as const,
        children: [{
          name: "index.ts",
          relativePath: "src/index.ts",
          kind: "file" as const
        }]
      }],
      totalEntries: 2,
      truncated: false
    })),
    searchProject: vi.fn(async (_projectId: string, query: string) => ({
      query,
      matches: [],
      filesScanned: 3,
      truncated: false
    })),
    readProjectFile: vi.fn(async () => ({
      uri: "routemarket-work://project/project_1/src/index.ts",
      text: "old",
      bytesRead: 3,
      truncated: false,
      encoding: "utf8" as const,
      sha256: "a".repeat(64)
    })),
    writeProjectFile: vi.fn(async () => ({
      uri: "routemarket-work://project/project_1/src/index.ts",
      text: "new",
      bytesRead: 3,
      truncated: false,
      encoding: "utf8" as const,
      sha256: "b".repeat(64),
      previousSha256: "a".repeat(64),
      changed: true
    })),
    createProjectFile: vi.fn(async () => ({
      uri: "routemarket-work://project/project_1/src/new.ts",
      text: "new",
      bytesRead: 3,
      truncated: false,
      encoding: "utf8" as const,
      sha256: "b".repeat(64),
      created: true as const
    })),
    startProcess: vi.fn(async () => projectProcess),
    listProcesses: vi.fn(async () => [
      projectProcess,
      { ...projectProcess, processId: "process_other", localProjectId: "project_2" }
    ]),
    stopProcess: vi.fn(async () => ({ ...projectProcess, status: "stopped" as const }))
  };
}

describe("ProjectChatToolRunner", () => {
  it("runs project reads at R0 without prompting", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_1",
      name: "project_read_file",
      arguments: '{"path":"src/index.ts"}'
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      path: "src/index.ts",
      text: "old",
      sha256: "a".repeat(64)
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(worker.readProjectFile).toHaveBeenCalledWith(
      "project_1",
      "src/index.ts"
    );
  });

  it("requires Tool Broker approval before writing a project file", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_2",
      name: "project_write_file",
      arguments: JSON.stringify({
        path: "src/index.ts",
        text: "new",
        expected_sha256: "a".repeat(64)
      })
    });

    expect(result).toMatchObject({
      isError: false,
      summary: "已修改 src/index.ts"
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "local.fs.write",
        risk: "R1",
        projectId: "project_1"
      })
    );
    expect(worker.writeProjectFile).toHaveBeenCalledWith(
      "project_1",
      "src/index.ts",
      "new",
      "a".repeat(64)
    );
  });

  it("returns a structured error and does not execute invalid arguments", async () => {
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(async () => true)
    });

    const result = await runner.execute("project_1", {
      id: "call_3",
      name: "project_write_file",
      arguments: '{"path":"src/index.ts","text":"new","expected_sha256":"bad"}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: {
        code: "LOCAL_TOOL_ERROR"
      }
    });
    expect(worker.writeProjectFile).not.toHaveBeenCalled();
  });

  it("starts a project process through R2 approval with separate arguments", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_4",
      name: "project_start_process",
      arguments: JSON.stringify({
        executable: "pnpm",
        args: ["test"],
        wait_ms: 0
      })
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      process_id: "process_1",
      executable: "pnpm",
      args: ["test"],
      status: "exited",
      stdout: "Tests passed"
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "local.process.start",
        risk: "R2",
        projectId: "project_1"
      })
    );
    expect(worker.startProcess).toHaveBeenCalledWith(
      "project_1",
      "pnpm",
      ["test"]
    );
  });

  it("lists only processes belonging to the current project", async () => {
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(async () => true)
    });

    const result = await runner.execute("project_1", {
      id: "call_5",
      name: "project_list_processes",
      arguments: "{}"
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content).processes).toEqual([
      expect.objectContaining({ process_id: "process_1" })
    ]);
  });

  it("does not stop a process owned by another project", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_6",
      name: "project_stop_process",
      arguments: '{"process_id":"process_other"}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "PROCESS_NOT_FOUND" }
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(worker.stopProcess).not.toHaveBeenCalled();
  });

  it("stops a current-project process through R2 approval", async () => {
    const confirm = vi.fn(async () => true);
    const worker = createWorker();
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(confirm)
    });

    const result = await runner.execute("project_1", {
      id: "call_7",
      name: "project_stop_process",
      arguments: '{"process_id":"process_1"}'
    });

    expect(result).toMatchObject({
      isError: false,
      summary: "已停止 pnpm · process_1"
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "local.process.stop",
        risk: "R2",
        projectId: "project_1"
      })
    );
    expect(worker.stopProcess).toHaveBeenCalledWith("process_1");
  });

  it("cancels waiting for process output without stopping the started process", async () => {
    const worker = createWorker();
    const runningProcess = {
      ...projectProcess,
      status: "running" as const,
      exitCode: null,
      finishedAt: null
    };
    worker.startProcess.mockResolvedValue(runningProcess);
    worker.listProcesses.mockResolvedValue([runningProcess]);
    const runner = new ProjectChatToolRunner({
      workerClient: worker,
      toolBroker: new LocalToolBroker(async () => true)
    });
    const controller = new AbortController();

    const pending = runner.execute(
      "project_1",
      {
        id: "call_8",
        name: "project_start_process",
        arguments: JSON.stringify({
          executable: "pnpm",
          args: ["dev"],
          wait_ms: 15_000
        })
      },
      controller.signal
    );
    await vi.waitFor(() => expect(worker.startProcess).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.stopProcess).not.toHaveBeenCalled();
  });
});
