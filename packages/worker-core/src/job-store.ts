import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { DesktopJob, JobEvent } from "@routemarket/work-protocol";
import { WorkerError } from "./errors";

export type JobStatus =
  | "received"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type JobRecoveryState = {
  jobId: string;
  leaseId: string | null;
  leaseEpoch: number;
  localStatus: JobStatus;
  lastProducedSeq: number;
  lastAckedSeq: number;
};

const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "failed", "canceled"]);

type StoredJobRow = {
  job_id: string;
  idempotency_key: string;
  status: JobStatus;
  payload_json: string;
  result_json: string | null;
  lease_id: string | null;
  lease_epoch: number;
  created_at: string;
  updated_at: string;
};

export class JobStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_jobs (
        job_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        lease_id TEXT,
        lease_epoch INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worker_outbox (
        event_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        acked_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(job_id, seq)
      );
    `);
    this.ensureColumn("worker_jobs", "lease_id", "TEXT");
    this.ensureColumn("worker_jobs", "lease_epoch", "INTEGER NOT NULL DEFAULT 0");
  }

  receive(job: DesktopJob): { duplicate: boolean; status: JobStatus; jobId: string } {
    const byIdempotency = this.db.prepare(
      "SELECT * FROM worker_jobs WHERE idempotency_key = ? LIMIT 1"
    ).get(job.idempotencyKey) as StoredJobRow | undefined;
    if (byIdempotency) {
      if (byIdempotency.job_id !== job.jobId) {
        throw new WorkerError(
          "JOB_IDEMPOTENCY_CONFLICT",
          "The idempotency key is already assigned to another Job."
        );
      }
      return { duplicate: true, status: byIdempotency.status, jobId: byIdempotency.job_id };
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO worker_jobs (
        job_id, idempotency_key, status, payload_json, created_at, updated_at
      ) VALUES (?, ?, 'received', ?, ?, ?)
    `).run(job.jobId, job.idempotencyKey, JSON.stringify(job), now, now);
    return { duplicate: false, status: "received", jobId: job.jobId };
  }

  beginExecution(
    jobId: string,
    leaseId: string,
    leaseEpoch: number
  ): { execute: boolean; status: JobStatus; nextSeq: number } {
    if (!leaseId || leaseEpoch < 1) {
      throw new WorkerError("JOB_LEASE_INVALID", "A valid Job lease is required.");
    }

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.getRow(jobId);
      if (TERMINAL_STATUSES.has(row.status)) {
        const nextSeq = this.nextSequence(jobId);
        this.db.exec("COMMIT;");
        return { execute: false, status: row.status, nextSeq };
      }
      if (leaseEpoch < row.lease_epoch) {
        throw new WorkerError("JOB_LEASE_STALE", "An older Job lease cannot resume execution.");
      }
      if (leaseEpoch === row.lease_epoch && row.lease_id && row.lease_id !== leaseId) {
        throw new WorkerError("JOB_LEASE_CONFLICT", "The Job lease does not match the active lease.");
      }

      this.db.prepare(`
        UPDATE worker_jobs
        SET lease_id = ?, lease_epoch = ?, updated_at = ?
        WHERE job_id = ?
      `).run(leaseId, leaseEpoch, new Date().toISOString(), jobId);
      const nextSeq = this.nextSequence(jobId);
      this.db.exec("COMMIT;");
      return { execute: true, status: row.status, nextSeq };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  commitEvent(event: JobEvent, nextStatus?: string, result?: Record<string, unknown>): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.getRow(event.jobId);
      if (TERMINAL_STATUSES.has(row.status)) {
        throw new WorkerError("JOB_ALREADY_TERMINAL", "A terminal Job cannot accept more events.");
      }
      if (event.leaseEpoch < row.lease_epoch) {
        throw new WorkerError("JOB_LEASE_STALE", "An older Job lease cannot commit events.");
      }
      if (
        event.leaseEpoch === row.lease_epoch &&
        row.lease_id &&
        event.leaseId !== row.lease_id
      ) {
        throw new WorkerError("JOB_LEASE_CONFLICT", "The Job event lease is not active.");
      }
      if (event.seq !== this.nextSequence(event.jobId)) {
        throw new WorkerError("JOB_EVENT_SEQUENCE_INVALID", "Job events must be committed in order.");
      }
      if (nextStatus && !isJobStatus(nextStatus)) {
        throw new WorkerError("JOB_STATUS_INVALID", `Unsupported Job status: ${nextStatus}`);
      }

      this.db.prepare(`
        INSERT OR IGNORE INTO worker_outbox (
          event_id, job_id, seq, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(event.eventId, event.jobId, event.seq, JSON.stringify(event), event.occurredAt);

      if (nextStatus) {
        this.db.prepare(`
          UPDATE worker_jobs
          SET status = ?, result_json = COALESCE(?, result_json), updated_at = ?
          WHERE job_id = ?
        `).run(
          nextStatus,
          result ? JSON.stringify(result) : null,
          event.occurredAt,
          event.jobId
        );
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  pendingEvents(jobId?: string): JobEvent[] {
    const rows = this.db.prepare(jobId ? `
      SELECT payload_json FROM worker_outbox
      WHERE acked_at IS NULL AND job_id = ?
      ORDER BY seq ASC
    ` : `
      SELECT payload_json FROM worker_outbox
      WHERE acked_at IS NULL
      ORDER BY job_id ASC, seq ASC
    `).all(...(jobId ? [jobId] : [])) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as JobEvent);
  }

  eventsFrom(jobId: string, sequence: number): JobEvent[] {
    if (!jobId || !Number.isInteger(sequence) || sequence < 1) {
      throw new WorkerError("JOB_EVENT_SEQUENCE_INVALID", "A positive resend sequence is required.");
    }
    const rows = this.db.prepare(`
      SELECT payload_json FROM worker_outbox
      WHERE job_id = ? AND seq >= ?
      ORDER BY seq ASC
    `).all(jobId, sequence) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as JobEvent);
  }

  acknowledge(eventId: string): void {
    this.db.prepare(
      "UPDATE worker_outbox SET acked_at = ? WHERE event_id = ?"
    ).run(new Date().toISOString(), eventId);
  }

  getStatus(jobId: string): JobStatus {
    return this.getRow(jobId).status;
  }

  recoveryState(): JobRecoveryState[] {
    const rows = this.db.prepare(`
      SELECT
        jobs.job_id,
        jobs.lease_id,
        jobs.lease_epoch,
        jobs.status,
        COALESCE(MAX(outbox.seq), 0) AS last_produced_seq,
        COALESCE(MAX(CASE WHEN outbox.acked_at IS NOT NULL THEN outbox.seq END), 0) AS last_acked_seq,
        COALESCE(SUM(CASE WHEN outbox.acked_at IS NULL AND outbox.event_id IS NOT NULL THEN 1 ELSE 0 END), 0)
          AS pending_events
      FROM worker_jobs AS jobs
      LEFT JOIN worker_outbox AS outbox ON outbox.job_id = jobs.job_id
      GROUP BY jobs.job_id
      HAVING jobs.status NOT IN ('succeeded', 'failed', 'canceled') OR pending_events > 0
      ORDER BY jobs.created_at ASC
    `).all() as Array<{
      job_id: string;
      lease_id: string | null;
      lease_epoch: number;
      status: JobStatus;
      last_produced_seq: number;
      last_acked_seq: number;
    }>;
    return rows.map((row) => ({
      jobId: row.job_id,
      leaseId: row.lease_id,
      leaseEpoch: row.lease_epoch,
      localStatus: row.status,
      lastProducedSeq: row.last_produced_seq,
      lastAckedSeq: row.last_acked_seq
    }));
  }

  cancel(jobId: string, leaseId: string, leaseEpoch: number): JobEvent | null {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.getRow(jobId);
      if (TERMINAL_STATUSES.has(row.status)) {
        this.db.exec("COMMIT;");
        return null;
      }
      if (leaseEpoch < row.lease_epoch) {
        throw new WorkerError("JOB_LEASE_STALE", "An older Job lease cannot cancel execution.");
      }
      if (leaseEpoch === row.lease_epoch && row.lease_id && row.lease_id !== leaseId) {
        throw new WorkerError("JOB_LEASE_CONFLICT", "The cancellation lease is not active.");
      }

      const job = JSON.parse(row.payload_json) as DesktopJob;
      const occurredAt = new Date().toISOString();
      const canceled: JobEvent = {
        eventId: `event_${randomUUID().replaceAll("-", "")}`,
        jobId,
        runtimeId: job.runtimeId,
        leaseId,
        leaseEpoch,
        seq: this.nextSequence(jobId),
        eventType: "job.canceled",
        occurredAt,
        data: {}
      };
      this.db.prepare(`
        INSERT INTO worker_outbox (event_id, job_id, seq, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(canceled.eventId, jobId, canceled.seq, JSON.stringify(canceled), occurredAt);
      this.db.prepare(`
        UPDATE worker_jobs
        SET status = 'canceled', lease_id = ?, lease_epoch = ?, updated_at = ?
        WHERE job_id = ?
      `).run(leaseId, leaseEpoch, occurredAt, jobId);
      this.db.exec("COMMIT;");
      return canceled;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  private getRow(jobId: string): StoredJobRow {
    const row = this.db.prepare(
      "SELECT * FROM worker_jobs WHERE job_id = ? LIMIT 1"
    ).get(jobId) as StoredJobRow | undefined;
    if (!row) throw new WorkerError("JOB_NOT_FOUND", "The Job is not stored locally.");
    return row;
  }

  private nextSequence(jobId: string): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM worker_outbox WHERE job_id = ?"
    ).get(jobId) as { next_seq: number };
    return row.next_seq;
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((candidate) => candidate.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  close(): void {
    this.db.close();
  }
}

function isJobStatus(value: string): value is JobStatus {
  return value === "received" || value === "leased" || value === "running" ||
    value === "succeeded" || value === "failed" || value === "canceled";
}
