import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import capabilityManifestSchema from "../schemas/capability-manifest.schema.json";
import desktopJobSchema from "../schemas/desktop-job.schema.json";
import envelopeSchema from "../schemas/envelope.schema.json";
import jobEventSchema from "../schemas/job-event.schema.json";

export const WORK_PROTOCOL = "routemarket-work/1" as const;

export type WorkMessageType =
  | "session.ready"
  | "runtime.hello"
  | "runtime.resume"
  | "runtime.heartbeat"
  | "runtime.ping"
  | "runtime.pong"
  | "runtime.capability_refresh"
  | "auth.expiring"
  | "job.offer"
  | "job.accept"
  | "job.reject"
  | "job.cancel"
  | "job.cancel_ack"
  | "job.event"
  | "job.event_ack"
  | "job.event_nack";

export type WorkEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  protocol: typeof WORK_PROTOCOL;
  messageId: string;
  type: WorkMessageType;
  sentAt: string;
  payload: TPayload;
};

export type DesktopJob = {
  jobId: string;
  workflowRunId?: string | null;
  workflowNodeRunId?: string | null;
  runtimeId: string;
  projectBindingId: string;
  executorKey: "local.fs.read";
  executorVersion: 1;
  input: {
    uri: string;
    maxBytes?: number;
  };
  requiredCapabilities: ["local.fs.read"];
  executionClass: "pure_read";
  approvalPolicy: {
    risk: "R0";
    mode: "project_grant";
  };
  idempotencyKey: string;
  deadlineAt: string;
  maxInlineResultBytes: number;
};

export type JobEventType =
  | "job.accepted"
  | "job.started"
  | "job.progress"
  | "job.log"
  | "approval.requested"
  | "approval.resolved"
  | "artifact.ready"
  | "job.succeeded"
  | "job.failed"
  | "job.canceled";

export type JobEvent = {
  eventId: string;
  jobId: string;
  runtimeId: string;
  leaseId: string;
  leaseEpoch: number;
  seq: number;
  eventType: JobEventType;
  occurredAt: string;
  data: Record<string, unknown>;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ErrorObject[] };

const ajv = new Ajv2020({
  allErrors: true,
  strict: true
});
addFormats(ajv);

const validateEnvelope = ajv.compile(envelopeSchema);
const validateCapabilityManifest = ajv.compile(capabilityManifestSchema);
const validateDesktopJob = ajv.compile(desktopJobSchema);
const validateJobEvent = ajv.compile(jobEventSchema);

function runValidation(validate: ValidateFunction, value: unknown): ValidationResult {
  return validate(value)
    ? { ok: true }
    : { ok: false, errors: validate.errors ? [...validate.errors] : [] };
}

export function checkEnvelope(value: unknown): ValidationResult {
  return runValidation(validateEnvelope, value);
}

export function checkCapabilityManifest(value: unknown): ValidationResult {
  return runValidation(validateCapabilityManifest, value);
}

export function checkDesktopJob(value: unknown): ValidationResult {
  return runValidation(validateDesktopJob, value);
}

export function checkJobEvent(value: unknown): ValidationResult {
  return runValidation(validateJobEvent, value);
}

export function assertDesktopJob(value: unknown): asserts value is DesktopJob {
  const result = checkDesktopJob(value);
  if (!result.ok) {
    throw new Error(`Invalid desktop job: ${ajv.errorsText(result.errors)}`);
  }
}
