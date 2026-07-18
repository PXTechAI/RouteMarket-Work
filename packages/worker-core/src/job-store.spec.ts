import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopJob, JobEvent, JobEventType } from "@routemarket/work-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { JobStore } from "./job-store";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "routemarket-job-store-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "worker.db");
}

function job(jobId = "djob_reliable_1"): DesktopJob {
  return {
    jobId,
    workflowRunId: null,
    workflowNodeRunId: null,
    runtimeId: "runtime_reliable_1",
    projectBindingId: "binding_reliable_1",
    executorKey: "local.fs.read",
    executorVersion: 1,
    input: { uri: "project://project_reliable_1/README.md" },
    requiredCapabilities: ["local.fs.read"],
    executionClass: "pure_read",
    approvalPolicy: { risk: "R0", mode: "project_grant" },
    idempotencyKey: `sha256:${createHash("sha256").update("reliable-job").digest("hex")}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxInlineResultBytes: 65_536
  };
}

function event(seq: number, eventType: JobEventType, leaseEpoch = 1): JobEvent {
  return {
    eventId: `event_reliable_${seq}_${leaseEpoch}`,
    jobId: "djob_reliable_1",
    runtimeId: "runtime_reliable_1",
    leaseId: `lease_reliable_${leaseEpoch}`,
    leaseEpoch,
    seq,
    eventType,
    occurredAt: new Date().toISOString(),
    data: {}
  };
}

describe("JobStore", () => {
  it("persists terminal events for retry and never re-executes a terminal Job", async () => {
    const databasePath = await fixture();
    let store = new JobStore(databasePath);
    store.receive(job());
    expect(store.beginExecution("djob_reliable_1", "lease_reliable_1", 1)).toEqual({
      execute: true,
      status: "received",
      nextSeq: 1
    });
    store.commitEvent(event(1, "job.accepted"), "leased");
    store.commitEvent(event(2, "job.started"), "running");
    store.commitEvent(event(3, "job.succeeded"), "succeeded", { text: "done" });
    store.close();

    store = new JobStore(databasePath);
    expect(store.recoveryState()).toEqual([{
      jobId: "djob_reliable_1",
      leaseId: "lease_reliable_1",
      leaseEpoch: 1,
      localStatus: "succeeded",
      lastProducedSeq: 3,
      lastAckedSeq: 0
    }]);
    expect(store.pendingEvents().map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(store.beginExecution("djob_reliable_1", "lease_reliable_2", 2)).toEqual({
      execute: false,
      status: "succeeded",
      nextSeq: 4
    });
    store.acknowledge("event_reliable_1_1");
    expect(store.pendingEvents().map((item) => item.seq)).toEqual([2, 3]);
    expect(store.eventsFrom("djob_reliable_1", 1).map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(store.recoveryState()[0]?.lastAckedSeq).toBe(1);
    store.acknowledge("event_reliable_2_1");
    store.acknowledge("event_reliable_3_1");
    expect(store.recoveryState()).toEqual([]);
    store.close();
  });

  it("rejects an old lease after a newer lease takes ownership", async () => {
    const store = new JobStore(await fixture());
    store.receive(job());
    store.beginExecution("djob_reliable_1", "lease_reliable_1", 1);
    store.commitEvent(event(1, "job.accepted"), "leased");
    store.beginExecution("djob_reliable_1", "lease_reliable_2", 2);
    expect(() => store.commitEvent(event(2, "job.started", 1), "running")).toThrowError(
      expect.objectContaining({ code: "JOB_LEASE_STALE" })
    );
    store.commitEvent(event(2, "job.started", 2), "running");
    store.close();
  });

  it("rejects idempotency-key reuse by a different Job", async () => {
    const store = new JobStore(await fixture());
    store.receive(job());
    expect(() => store.receive(job("djob_reliable_2"))).toThrowError(
      expect.objectContaining({ code: "JOB_IDEMPOTENCY_CONFLICT" })
    );
    store.close();
  });

  it("requires events to be committed in sequence", async () => {
    const store = new JobStore(await fixture());
    store.receive(job());
    store.beginExecution("djob_reliable_1", "lease_reliable_1", 1);
    expect(() => store.commitEvent(event(2, "job.started"), "running")).toThrowError(
      expect.objectContaining({ code: "JOB_EVENT_SEQUENCE_INVALID" })
    );
    store.close();
  });

  it("persists cancellation as the winning terminal state", async () => {
    const store = new JobStore(await fixture());
    store.receive(job());
    store.beginExecution("djob_reliable_1", "lease_reliable_1", 1);
    store.commitEvent(event(1, "job.accepted"), "leased");
    store.commitEvent(event(2, "job.started"), "running");
    const canceled = store.cancel("djob_reliable_1", "lease_reliable_1", 1);
    expect(canceled).toMatchObject({ seq: 3, eventType: "job.canceled" });
    expect(store.getStatus("djob_reliable_1")).toBe("canceled");
    expect(() =>
      store.commitEvent(event(4, "job.succeeded"), "succeeded", { text: "too late" })
    ).toThrowError(expect.objectContaining({ code: "JOB_ALREADY_TERMINAL" }));
    expect(store.cancel("djob_reliable_1", "lease_reliable_1", 1)).toBeNull();
    store.close();
  });
});
