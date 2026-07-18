import { describe, expect, it, vi } from "vitest";
import { LocalToolBroker } from "./tool-broker";
import { ProjectChatToolRunner } from "./project-chat-tool-runner";

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
    }))
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
});
