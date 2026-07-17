import { DatabaseSync } from "node:sqlite";
import type { DesktopJob, JobEvent } from "@routemarket/work-protocol";

type StoredJobRow = {
  job_id: string;
  idempotency_key: string;
  status: string;
  payload_json: string;
  result_json: string | null;
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
  }

  receive(job: DesktopJob): { duplicate: boolean; status: string } {
    const byIdempotency = this.db.prepare(
      "SELECT * FROM worker_jobs WHERE idempotency_key = ? LIMIT 1"
    ).get(job.idempotencyKey) as StoredJobRow | undefined;
    if (byIdempotency) {
      return { duplicate: true, status: byIdempotency.status };
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO worker_jobs (
        job_id, idempotency_key, status, payload_json, created_at, updated_at
      ) VALUES (?, ?, 'received', ?, ?, ?)
    `).run(job.jobId, job.idempotencyKey, JSON.stringify(job), now, now);
    return { duplicate: false, status: "received" };
  }

  commitEvent(event: JobEvent, nextStatus?: string, result?: Record<string, unknown>): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
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

  acknowledge(eventId: string): void {
    this.db.prepare(
      "UPDATE worker_outbox SET acked_at = ? WHERE event_id = ?"
    ).run(new Date().toISOString(), eventId);
  }

  close(): void {
    this.db.close();
  }
}
