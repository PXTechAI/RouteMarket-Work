import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeLocalFsRead } from "./local-fs-read";
import { writeLocalProjectFile } from "./local-fs-write";
import { projectBindingIdFor } from "./project-binding";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-write-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, "note.txt"), "before\n", "utf8");
  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  const read = await executeLocalFsRead(registry, {
    jobId: "djob_write_test",
    runtimeId: "runtime_write_test",
    projectBindingId: projectBindingIdFor(project.localProjectId),
    executorKey: "local.fs.read",
    executorVersion: 1,
    input: { uri: `project://${project.localProjectId}/note.txt` },
    requiredCapabilities: ["local.fs.read"],
    executionClass: "pure_read",
    approvalPolicy: { risk: "R0", mode: "project_grant" },
    idempotencyKey: `sha256:${"a".repeat(64)}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxInlineResultBytes: 262_144
  });
  return { registry, project, projectRoot, read };
}

describe("local file writes", () => {
  it("atomically replaces an existing project file", async () => {
    const value = await fixture();
    const result = await writeLocalProjectFile(value.registry, {
      localProjectId: value.project.localProjectId,
      relativePath: "note.txt",
      text: "after\n",
      expectedSha256: value.read.sha256
    });
    expect(result).toMatchObject({ text: "after\n", changed: true });
    await expect(readFile(join(value.projectRoot, "note.txt"), "utf8")).resolves.toBe("after\n");
  });

  it("does not overwrite a file changed by another process", async () => {
    const value = await fixture();
    await writeFile(join(value.projectRoot, "note.txt"), "external\n", "utf8");
    await expect(writeLocalProjectFile(value.registry, {
      localProjectId: value.project.localProjectId,
      relativePath: "note.txt",
      text: "my edit\n",
      expectedSha256: value.read.sha256
    })).rejects.toMatchObject({ code: "PROJECT_FILE_CONFLICT" });
    await expect(readFile(join(value.projectRoot, "note.txt"), "utf8")).resolves.toBe("external\n");
  });
});
