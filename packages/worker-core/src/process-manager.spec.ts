import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ControlledProcessManager } from "./process-manager";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-process-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  const manager = new ControlledProcessManager(registry);
  cleanups.push(() => manager.stopAll());
  return { project, manager };
}

async function waitForExit(manager: ControlledProcessManager, processId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = manager.get(processId);
    if (value.status !== "running") return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Managed process did not exit in time.");
}

describe("ControlledProcessManager", () => {
  it("captures stdout, stderr and exit state", async () => {
    const value = await fixture();
    const started = value.manager.start({
      localProjectId: value.project.localProjectId,
      executable: process.execPath,
      args: ["-e", "console.log('hello'); console.error('warning')"]
    });
    const finished = await waitForExit(value.manager, started.processId);
    expect(finished).toMatchObject({ status: "exited", exitCode: 0 });
    expect(finished.stdout).toContain("hello");
    expect(finished.stderr).toContain("warning");
  });

  it("does not pass secret-bearing environment variables to tools", async () => {
    const value = await fixture();
    process.env.ROUTEMARKET_TEST_SECRET = "must-not-leak";
    try {
      const started = value.manager.start({
        localProjectId: value.project.localProjectId,
        executable: process.execPath,
        args: ["-e", "console.log(process.env.ROUTEMARKET_TEST_SECRET || 'redacted')"]
      });
      const finished = await waitForExit(value.manager, started.processId);
      expect(finished.stdout.trim()).toBe("redacted");
    } finally {
      delete process.env.ROUTEMARKET_TEST_SECRET;
    }
  });

  it("stops a long-running process", async () => {
    const value = await fixture();
    const started = value.manager.start({
      localProjectId: value.project.localProjectId,
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"]
    });
    await expect(value.manager.stop(started.processId)).resolves.toMatchObject({
      status: "stopped"
    });
  });
});
