import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import capabilityManifestSchema from "../schemas/capability-manifest.schema.json";
import desktopJobSchema from "../schemas/desktop-job.schema.json";
import desktopNodeRegistrySchema from "../schemas/desktop-node-registry.schema.json";
import envelopeSchema from "../schemas/envelope.schema.json";
import jobEventSchema from "../schemas/job-event.schema.json";
import pluginManifestSchema from "../schemas/plugin-manifest.schema.json";

export type PluginPermission =
  | LocalSkillPermission
  | "browser.read"
  | "browser.interact"
  | "artifact.read"
  | "artifact.write";

export type PluginViewerContribution = {
  id: string;
  title: string;
  status: "available" | "planned" | "disabled";
  extensions: string[];
  mimeTypes: string[];
  mode: "readonly" | "editable";
};

export type PluginToolContribution = {
  name: string;
  title: string;
  status: "available" | "planned" | "disabled";
  description: string;
  capability: string;
  risk: "R0" | "R1" | "R2" | "R3";
};

export type PluginWorkflowNodeContribution = {
  executorKey: string;
  title: string;
  status: "available" | "planned" | "disabled";
  description: string;
};

export type PluginConnectorContribution = {
  id: string;
  title: string;
  status: "available" | "planned" | "disabled";
  kind: "browser_provider" | "native_app" | "remote_service";
};

export type PluginDistribution =
  | {
      source: "bundled";
      packageFormat: "declarative";
    }
  | {
      source: "marketplace";
      packageFormat: "declarative";
    };

export type PluginManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  kind: "host_runtime" | "declarative_plugin";
  status: "available" | "planned" | "disabled";
  distribution: PluginDistribution;
  engines: { routemarketWork: string };
  permissions: PluginPermission[];
  activationEvents: string[];
  contributes: {
    viewers: PluginViewerContribution[];
    tools: PluginToolContribution[];
    workflowNodes: PluginWorkflowNodeContribution[];
    connectors: PluginConnectorContribution[];
  };
};

export const WORK_PROTOCOL = "routemarket-work/1" as const;

export type LocalSkillPermission =
  | "project.read"
  | "project.write"
  | "network"
  | "process"
  | "external_apps";

export type LocalSkillIdentity = {
  skillId: string;
  version: string;
  packageDigest: string;
  signingKeyId: string;
  signature: string;
  projectBindingId: string | null;
  permissions: LocalSkillPermission[];
  operations: string[];
};

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

type DesktopJobBase = {
  jobId: string;
  workflowRunId?: string | null;
  workflowNodeRunId?: string | null;
  runtimeId: string;
  projectBindingId: string;
  executorVersion: 1;
  idempotencyKey: string;
  deadlineAt: string;
  maxInlineResultBytes: number;
};

export type DesktopJob = DesktopJobBase & (
  | {
      executorKey: "local.fs.read";
      input: { uri: string; maxBytes?: number };
      requiredCapabilities: ["local.fs.read"];
      executionClass: "pure_read";
      approvalPolicy: { risk: "R0"; mode: "project_grant" };
    }
  | {
      executorKey: "local.browser.navigate";
      input: { url: string };
      requiredCapabilities: ["local.browser.navigate"];
      executionClass: "external_side_effect";
      approvalPolicy: { risk: "R1"; mode: "invocation" };
    }
  | {
      executorKey: "local.browser.click";
      input: { selector: string };
      requiredCapabilities: ["local.browser.click"];
      executionClass: "external_side_effect";
      approvalPolicy: { risk: "R2"; mode: "invocation" };
    }
  | {
      executorKey: "local.browser.type";
      input: { selector: string; text: string };
      requiredCapabilities: ["local.browser.type"];
      executionClass: "external_side_effect";
      approvalPolicy: { risk: "R2"; mode: "invocation" };
    }
  | {
      executorKey: "local.browser.extract";
      input: { selector: string };
      requiredCapabilities: ["local.browser.extract"];
      executionClass: "pure_read";
      approvalPolicy: { risk: "R0"; mode: "project_grant" };
    }
  | {
      executorKey: "local.browser.screenshot";
      input: Record<string, never>;
      requiredCapabilities: ["local.browser.screenshot"];
      executionClass: "pure_read";
      approvalPolicy: { risk: "R0"; mode: "project_grant" };
    }
  | {
      executorKey: "local.browser.upload";
      input: { selector: string; relativePaths: string[]; pageId?: string };
      requiredCapabilities: ["local.browser.upload"];
      executionClass: "external_side_effect";
      approvalPolicy: { risk: "R3"; mode: "invocation" };
    }
  | {
      executorKey: "local.mcp.call";
      input: { serverId: string; name: string; arguments: Record<string, unknown> };
      requiredCapabilities: ["local.mcp.call"];
      executionClass: "external_side_effect";
      approvalPolicy: { risk: "R2"; mode: "invocation" };
    }
  | {
      executorKey: "local.skill.invoke";
      input: {
        skillId: string;
        version: string;
        packageDigest: string;
        signingKeyId: string;
        operation: string;
        task: string;
      };
      requiredCapabilities: ["local.skill.invoke"];
      executionClass: "external_side_effect";
      approvalPolicy: { risk: "R3"; mode: "invocation" };
    }
  | {
      executorKey: "local.app.open";
      input: { connectorId: "vscode" | "excel" | "powerpoint"; relativePath?: string };
      requiredCapabilities: ["local.app.open"];
      executionClass: "external_side_effect";
      approvalPolicy: { risk: "R2"; mode: "invocation" };
    }
);

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

export type DesktopWorkflowNodeDefinition = {
  executorKey: string;
  definitionVersion: number;
  source: "cloud" | "desktop_builtin" | "local_extension";
  executionTarget: "cloud" | "desktop" | "auto";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredCapabilities: string[];
  portability: "portable" | "requires_connector" | "device_bound";
  definitionHash: string;
  title: string;
  description: string;
  available: boolean;
  blockedReason: string | null;
};

export type DesktopWorkflowNodeRegistry = {
  revisionHash: string;
  generatedAt: string;
  definitions: DesktopWorkflowNodeDefinition[];
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
const validateDesktopNodeRegistry = ajv.compile(desktopNodeRegistrySchema);
const validateJobEvent = ajv.compile(jobEventSchema);
const validatePluginManifest = ajv.compile(pluginManifestSchema);

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

export function checkDesktopNodeRegistry(value: unknown): ValidationResult {
  return runValidation(validateDesktopNodeRegistry, value);
}

export function checkJobEvent(value: unknown): ValidationResult {
  return runValidation(validateJobEvent, value);
}

export function checkPluginManifest(value: unknown): ValidationResult {
  return runValidation(validatePluginManifest, value);
}

export function assertPluginManifest(value: unknown): asserts value is PluginManifest {
  const result = checkPluginManifest(value);
  if (!result.ok) {
    throw new Error(`Invalid plugin manifest: ${ajv.errorsText(result.errors)}`);
  }
}

export function assertDesktopJob(value: unknown): asserts value is DesktopJob {
  const result = checkDesktopJob(value);
  if (!result.ok) {
    throw new Error(`Invalid desktop job: ${ajv.errorsText(result.errors)}`);
  }
}
