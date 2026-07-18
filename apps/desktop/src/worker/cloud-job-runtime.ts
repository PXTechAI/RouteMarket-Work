import { randomUUID } from "node:crypto";
import { assertDesktopJob, type DesktopJob, type JobEvent } from "@routemarket/work-protocol";
import {
  executeLocalFsRead,
  executeLocalSkillInvoke,
  JobStore,
  ProjectRegistry,
  WorkerError
} from "@routemarket/work-worker-core";

type JobLeaseInput = {
  job: DesktopJob;
  leaseId: string;
  leaseEpoch: number;
};

export class CloudJobRuntime {
  private readonly activeJobs = new Set<string>();

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly jobStore: JobStore
  ) {}

  async executeJob(input: JobLeaseInput): Promise<JobEvent[]> {
    const received = this.jobStore.receive(input.job);
    if (this.activeJobs.has(input.job.jobId)) {
      return this.jobStore.pendingEvents(input.job.jobId);
    }
    const execution = this.jobStore.beginExecution(
      input.job.jobId,
      input.leaseId,
      input.leaseEpoch
    );
    if (!execution.execute) return this.jobStore.pendingEvents(input.job.jobId);

    this.activeJobs.add(input.job.jobId);
    let nextSeq = execution.nextSeq;
    try {
      if (received.status === "received") {
        this.jobStore.commitEvent(
          createJobEvent(input, nextSeq++, "job.accepted", {}),
          "leased"
        );
      }
      if (received.status === "received" || received.status === "leased") {
        this.jobStore.commitEvent(
          createJobEvent(input, nextSeq++, "job.started", {}),
          "running"
        );
      }
      const result = await this.executeLocalJob(input.job);
      if (this.jobStore.getStatus(input.job.jobId) === "canceled") {
        return this.jobStore.pendingEvents(input.job.jobId);
      }
      this.jobStore.commitEvent(
        createJobEvent(input, nextSeq, "job.succeeded", result),
        "succeeded",
        result
      );
    } catch (error) {
      if (this.jobStore.getStatus(input.job.jobId) === "canceled") {
        return this.jobStore.pendingEvents(input.job.jobId);
      }
      const failure = {
        code: error instanceof WorkerError ? error.code : "WORKER_ERROR",
        message: error instanceof Error ? error.message : "Unknown worker error"
      };
      this.jobStore.commitEvent(
        createJobEvent(input, nextSeq, "job.failed", failure),
        "failed",
        failure
      );
    } finally {
      this.activeJobs.delete(input.job.jobId);
    }
    return this.jobStore.pendingEvents(input.job.jobId);
  }

  beginExternalJob(input: JobLeaseInput): { execute: boolean; events: JobEvent[] } {
    assertDesktopJob(input.job);
    const received = this.jobStore.receive(input.job);
    if (this.activeJobs.has(input.job.jobId)) {
      return { execute: false, events: this.jobStore.pendingEvents(input.job.jobId) };
    }
    const execution = this.jobStore.beginExecution(
      input.job.jobId,
      input.leaseId,
      input.leaseEpoch
    );
    if (!execution.execute) {
      return { execute: false, events: this.jobStore.pendingEvents(input.job.jobId) };
    }
    if (
      received.duplicate &&
      input.job.executionClass === "external_side_effect" &&
      (execution.status === "leased" || execution.status === "running")
    ) {
      const failure = {
        code: "JOB_EXECUTION_INTERRUPTED",
        message:
          "Desktop restarted while an external side-effect Job was running. " +
          "The Job was not replayed because its effects may already have occurred."
      };
      this.jobStore.commitEvent(
        createJobEvent(input, execution.nextSeq, "job.failed", failure),
        "failed",
        failure
      );
      return { execute: false, events: this.jobStore.pendingEvents(input.job.jobId) };
    }
    let nextSeq = execution.nextSeq;
    if (execution.status === "received") {
      this.jobStore.commitEvent(
        createJobEvent(input, nextSeq++, "job.accepted", {}),
        "leased"
      );
    }
    if (execution.status === "received" || execution.status === "leased") {
      this.jobStore.commitEvent(
        createJobEvent(input, nextSeq, "job.started", {}),
        "running"
      );
    }
    this.activeJobs.add(input.job.jobId);
    return { execute: true, events: this.jobStore.pendingEvents(input.job.jobId) };
  }

  completeExternalJob(
    input: JobLeaseInput & { result: Record<string, unknown> }
  ): JobEvent[] {
    try {
      if (this.jobStore.getStatus(input.job.jobId) === "canceled") {
        return this.jobStore.pendingEvents(input.job.jobId);
      }
      const state = this.recoveryState().find((job) => job.jobId === input.job.jobId);
      if (!state) return this.jobStore.pendingEvents(input.job.jobId);
      this.jobStore.commitEvent(
        createJobEvent(
          input,
          state.lastProducedSeq + 1,
          "job.succeeded",
          input.result
        ),
        "succeeded",
        input.result
      );
      return this.jobStore.pendingEvents(input.job.jobId);
    } finally {
      this.activeJobs.delete(input.job.jobId);
    }
  }

  failExternalJob(
    input: JobLeaseInput & { failure: { code: string; message: string } }
  ): JobEvent[] {
    try {
      if (this.jobStore.getStatus(input.job.jobId) === "canceled") {
        return this.jobStore.pendingEvents(input.job.jobId);
      }
      const state = this.recoveryState().find((job) => job.jobId === input.job.jobId);
      if (!state) return this.jobStore.pendingEvents(input.job.jobId);
      this.jobStore.commitEvent(
        createJobEvent(
          input,
          state.lastProducedSeq + 1,
          "job.failed",
          input.failure
        ),
        "failed",
        input.failure
      );
      return this.jobStore.pendingEvents(input.job.jobId);
    } finally {
      this.activeJobs.delete(input.job.jobId);
    }
  }

  cancelJob(jobId: string, leaseId: string, leaseEpoch: number): JobEvent[] {
    this.jobStore.cancel(jobId, leaseId, leaseEpoch);
    return this.jobStore.pendingEvents(jobId);
  }

  pendingEvents(): JobEvent[] {
    return this.jobStore.pendingEvents();
  }

  eventsFrom(jobId: string, sequence: number): JobEvent[] {
    return this.jobStore.eventsFrom(jobId, sequence);
  }

  recoveryState() {
    return this.jobStore.recoveryState();
  }

  acknowledgeEvent(eventId: string): { acknowledged: true } {
    this.jobStore.acknowledge(eventId);
    return { acknowledged: true };
  }

  private async executeLocalJob(job: DesktopJob): Promise<Record<string, unknown>> {
    if (job.executorKey === "local.fs.read") {
      return executeLocalFsRead(this.registry, job);
    }
    if (job.executorKey === "local.skill.invoke") {
      return executeLocalSkillInvoke(this.registry, job);
    }
    throw new WorkerError(
      "CAPABILITY_UNSUPPORTED",
      `Worker executor is unavailable: ${job.executorKey}`
    );
  }
}

function createJobEvent(
  input: JobLeaseInput,
  seq: number,
  eventType: JobEvent["eventType"],
  data: Record<string, unknown>
): JobEvent {
  return {
    eventId: `event_${randomUUID().replaceAll("-", "")}`,
    jobId: input.job.jobId,
    runtimeId: input.job.runtimeId,
    leaseId: input.leaseId,
    leaseEpoch: input.leaseEpoch,
    seq,
    eventType,
    occurredAt: new Date().toISOString(),
    data
  };
}
