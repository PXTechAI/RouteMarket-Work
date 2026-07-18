import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopJob } from "@routemarket/work-protocol";
import { JobStore, ProjectRegistry } from "@routemarket/work-worker-core";
import { afterEach, describe, expect, it } from "vitest";
import { CloudJobRuntime } from "./cloud-job-runtime";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "routemarket-cloud-job-runtime-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "work.db");
}

function sideEffectJob(): DesktopJob {
  return {
    jobId: "job_external_recovery_1",
    workflowRunId: "workflow_run_recovery_1",
    workflowNodeRunId: "workflow_node_recovery_1",
    runtimeId: "runtime_recovery_1",
    projectBindingId: "binding_recovery_1",
    executorKey: "local.browser.click",
    executorVersion: 1,
    input: { selector: "#submit" },
    requiredCapabilities: ["local.browser.click"],
    executionClass: "external_side_effect",
    approvalPolicy: { risk: "R2", mode: "invocation" },
    idempotencyKey: `sha256:${createHash("sha256")
      .update("external-recovery:side-effect")
      .digest("hex")}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxInlineResultBytes: 65_536
  };
}

function pureReadJob(): DesktopJob {
  return {
    jobId: "job_external_read_recovery_1",
    workflowRunId: "workflow_run_read_recovery_1",
    workflowNodeRunId: "workflow_node_read_recovery_1",
    runtimeId: "runtime_recovery_1",
    projectBindingId: "binding_recovery_1",
    executorKey: "local.browser.extract",
    executorVersion: 1,
    input: { selector: "main" },
    requiredCapabilities: ["local.browser.extract"],
    executionClass: "pure_read",
    approvalPolicy: { risk: "R0", mode: "project_grant" },
    idempotencyKey: `sha256:${createHash("sha256")
      .update("external-recovery:pure-read")
      .digest("hex")}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxInlineResultBytes: 65_536
  };
}

function openRuntime(databasePath: string) {
  const registry = new ProjectRegistry(databasePath);
  const store = new JobStore(databasePath);
  return {
    registry,
    store,
    runtime: new CloudJobRuntime(registry, store)
  };
}

function closeRuntime(resource: ReturnType<typeof openRuntime>) {
  resource.registry.close();
  resource.store.close();
}

describe("CloudJobRuntime external Job recovery", () => {
  it("fails an interrupted side-effect Job after restart without replaying it", async () => {
    const databasePath = await fixture();
    let opened: ReturnType<typeof openRuntime> | null = openRuntime(databasePath);
    const job = sideEffectJob();
    try {
      expect(opened.runtime.beginExternalJob({
        job,
        leaseId: "lease_recovery_1",
        leaseEpoch: 1
      })).toMatchObject({
        execute: true,
        events: [
          { eventType: "job.accepted", seq: 1 },
          { eventType: "job.started", seq: 2 }
        ]
      });
      closeRuntime(opened);
      opened = openRuntime(databasePath);

      const recovered = opened.runtime.beginExternalJob({
        job,
        leaseId: "lease_recovery_2",
        leaseEpoch: 2
      });

      expect(recovered.execute).toBe(false);
      expect(recovered.events).toHaveLength(3);
      expect(recovered.events[2]).toMatchObject({
        leaseId: "lease_recovery_2",
        leaseEpoch: 2,
        seq: 3,
        eventType: "job.failed",
        data: {
          code: "JOB_EXECUTION_INTERRUPTED"
        }
      });
      expect(opened.store.getStatus(job.jobId)).toBe("failed");

      expect(opened.runtime.beginExternalJob({
        job,
        leaseId: "lease_recovery_3",
        leaseEpoch: 3
      })).toMatchObject({
        execute: false,
        events: [
          { seq: 1 },
          { seq: 2 },
          { seq: 3, eventType: "job.failed" }
        ]
      });
    } finally {
      if (opened) closeRuntime(opened);
    }
  });

  it("allows an interrupted pure-read external Job to retry", async () => {
    const databasePath = await fixture();
    let opened: ReturnType<typeof openRuntime> | null = openRuntime(databasePath);
    const job = pureReadJob();
    try {
      expect(opened.runtime.beginExternalJob({
        job,
        leaseId: "lease_read_1",
        leaseEpoch: 1
      }).execute).toBe(true);
      closeRuntime(opened);
      opened = openRuntime(databasePath);

      const recovered = opened.runtime.beginExternalJob({
        job,
        leaseId: "lease_read_2",
        leaseEpoch: 2
      });

      expect(recovered.execute).toBe(true);
      expect(recovered.events).toEqual([
        expect.objectContaining({ seq: 1, eventType: "job.accepted" }),
        expect.objectContaining({ seq: 2, eventType: "job.started" })
      ]);
    } finally {
      if (opened) closeRuntime(opened);
    }
  });
});
