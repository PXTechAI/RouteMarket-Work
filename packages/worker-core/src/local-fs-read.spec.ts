import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopJob } from "@routemarket/work-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { executeLocalFsRead } from "./local-fs-read";
import { projectBindingIdFor } from "./project-binding";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()?.();
  }
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-work-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, "README.md"), "# RouteMarket Work\n", "utf8");
  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  return { root, projectRoot, registry, project };
}

function makeJob(localProjectId: string, uriPath = "README.md"): DesktopJob {
  return {
    jobId: "djob_phase0_test",
    workflowRunId: null,
    workflowNodeRunId: null,
    runtimeId: "runtime_phase0_test",
    projectBindingId: projectBindingIdFor(localProjectId),
    executorKey: "local.fs.read",
    executorVersion: 1,
    input: {
      uri: `project://${localProjectId}/${uriPath}`,
      maxBytes: 65_536
    },
    requiredCapabilities: ["local.fs.read"],
    executionClass: "pure_read",
    approvalPolicy: {
      risk: "R0",
      mode: "project_grant"
    },
    idempotencyKey: `sha256:${createHash("sha256").update("phase0-test").digest("hex")}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxInlineResultBytes: 262_144
  };
}

describe("local.fs.read", () => {
  it("reads a UTF-8 file inside a bound project", async () => {
    const fixture = await createFixture();
    await expect(executeLocalFsRead(
      fixture.registry,
      makeJob(fixture.project.localProjectId)
    )).resolves.toMatchObject({
      text: "# RouteMarket Work\n",
      truncated: false,
      encoding: "utf8"
    });
  });

  it("rejects traversal outside the project", async () => {
    const fixture = await createFixture();
    await expect(executeLocalFsRead(
      fixture.registry,
      makeJob(fixture.project.localProjectId, "..%2Fsecret.txt")
    )).rejects.toMatchObject({
      code: "PROJECT_PATH_ESCAPE"
    });
  });

  it("rejects a symlink that resolves outside the project", async () => {
    const fixture = await createFixture();
    const outsideDirectory = join(fixture.root, "outside");
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, "secret.txt"), "secret", "utf8");
    await symlink(
      outsideDirectory,
      join(fixture.projectRoot, "linked-outside"),
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(executeLocalFsRead(
      fixture.registry,
      makeJob(fixture.project.localProjectId, "linked-outside/secret.txt")
    )).rejects.toMatchObject({
      code: "PROJECT_PATH_ESCAPE"
    });
  });

  it("rejects a Job whose binding does not authorize the URI project", async () => {
    const fixture = await createFixture();
    const invalidJob = makeJob(fixture.project.localProjectId);
    invalidJob.projectBindingId = projectBindingIdFor("project_someone_else");
    await expect(executeLocalFsRead(fixture.registry, invalidJob)).rejects.toMatchObject({
      code: "PROJECT_BINDING_INVALID"
    });
  });

  it("rejects an expired Job before reading the project", async () => {
    const fixture = await createFixture();
    const expiredJob = makeJob(fixture.project.localProjectId);
    expiredJob.deadlineAt = new Date(Date.now() - 1_000).toISOString();
    await expect(executeLocalFsRead(fixture.registry, expiredJob)).rejects.toMatchObject({
      code: "JOB_DEADLINE_EXCEEDED"
    });
  });
});
