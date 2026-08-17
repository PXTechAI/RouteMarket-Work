import { open } from "node:fs/promises";
import type { DesktopJob } from "@routemarket/work-protocol";
import { assertDesktopJob } from "@routemarket/work-protocol";
import { WorkerError } from "./errors";
import { projectBindingIdFor } from "./project-binding";
import { loadProjectContext } from "./project-context";
import { assertProjectSkillPackageIdentity } from "./local-skill-package";
import { ProjectRegistry } from "./project-registry";
import { resolveProjectFile } from "./project-uri";

const MAX_SKILL_ID_CHARACTERS = 256;
const MAX_TASK_CHARACTERS = 16_000;
const MAX_SKILL_INSTRUCTION_BYTES = 64 * 1024;

export type LocalSkillInvocationResult = {
  skillId: string;
  version?: string;
  packageDigest?: string;
  name: string;
  description: string;
  relativePath: string;
  task: string;
  instructions: string;
  truncated: boolean;
  directive: string;
};

export async function invokeProjectSkill(
  registry: ProjectRegistry,
  input: {
    localProjectId: string;
    skillId: string;
    task: string;
    maxInlineResultBytes?: number;
  }
): Promise<LocalSkillInvocationResult> {
  const skillId = requiredString(
    input.skillId,
    "skillId",
    MAX_SKILL_ID_CHARACTERS
  );
  const task = requiredString(input.task, "task", MAX_TASK_CHARACTERS);
  const project = registry.get(input.localProjectId);
  if (!project) {
    throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  }

  const context = await loadProjectContext(registry, input.localProjectId);
  const skill = context.skills.find((candidate) => candidate.id === skillId);
  if (!skill) {
    throw new WorkerError(
      "PROJECT_SKILL_NOT_AVAILABLE",
      "The project Skill is no longer available."
    );
  }

  const filePath = await resolveProjectFile(project, skill.relativePath);
  const handle = await open(filePath, "r");
  let instructions: string;
  let truncated: boolean;
  try {
    const buffer = Buffer.alloc(MAX_SKILL_INSTRUCTION_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(
      0,
      Math.min(bytesRead, MAX_SKILL_INSTRUCTION_BYTES)
    );
    if (content.includes(0)) {
      throw new WorkerError(
        "PROJECT_CONTEXT_BINARY",
        `${skill.relativePath} is not a text file.`
      );
    }
    instructions = content.toString("utf8");
    truncated = bytesRead > MAX_SKILL_INSTRUCTION_BYTES;
  } finally {
    await handle.close();
  }

  return fitInlineResult(
    {
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      relativePath: skill.relativePath,
      task,
      instructions,
      truncated,
      directive:
        "Apply these Skill instructions to the current task. Use separately authorized local Tools for concrete actions."
    },
    input.maxInlineResultBytes
  );
}

export async function executeLocalSkillInvoke(
  registry: ProjectRegistry,
  jobValue: unknown
): Promise<LocalSkillInvocationResult> {
  assertDesktopJob(jobValue);
  const job: DesktopJob = jobValue;
  if (Date.parse(job.deadlineAt) <= Date.now()) {
    throw new WorkerError("JOB_DEADLINE_EXCEEDED", "The Job deadline has expired.");
  }
  if (job.executorKey !== "local.skill.invoke") {
    throw new WorkerError(
      "CAPABILITY_UNSUPPORTED",
      `Unsupported executor: ${job.executorKey}`
    );
  }
  const project = registry.list().find(
    (candidate) => projectBindingIdFor(candidate.localProjectId) === job.projectBindingId
  );
  if (!project) {
    throw new WorkerError(
      "PROJECT_BINDING_INVALID",
      "The Job project binding does not authorize an available project."
    );
  }
  const identity = await assertProjectSkillPackageIdentity(registry, project.localProjectId, {
    skillId: job.input.skillId,
    version: job.input.version,
    packageDigest: job.input.packageDigest,
    operation: job.input.operation
  });
  const result = await invokeProjectSkill(registry, {
    localProjectId: project.localProjectId,
    skillId: job.input.skillId,
    task: job.input.task
  });
  return fitInlineResult({
    ...result,
    version: identity.version,
    packageDigest: identity.packageDigest
  }, job.maxInlineResultBytes);
}

function fitInlineResult(
  result: LocalSkillInvocationResult,
  maxBytes = 160_000
): LocalSkillInvocationResult {
  if (encodedBytes(result) <= maxBytes) return result;
  const base = { ...result, instructions: "", truncated: true };
  if (encodedBytes(base) > maxBytes) {
    throw new WorkerError(
      "RESULT_TOO_LARGE",
      "Skill metadata and task exceed the inline result limit."
    );
  }

  let low = 0;
  let high = result.instructions.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = {
      ...base,
      instructions: result.instructions.slice(0, middle)
    };
    if (encodedBytes(candidate) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return {
    ...base,
    instructions: result.instructions.slice(0, low)
  };
}

function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new WorkerError(
      "SKILL_INPUT_INVALID",
      `${field} must be a non-empty string up to ${maxLength} characters.`
    );
  }
  if (value.includes("\0")) {
    throw new WorkerError(
      "SKILL_INPUT_INVALID",
      `${field} contains an invalid character.`
    );
  }
  return value.trim();
}
