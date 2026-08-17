import { trMain } from "./i18n";
import { createHash } from "node:crypto";
import type {
  LocalSkillInvocationResult,
  ProjectContext
} from "../shared/desktop-api";
import type { WorkerClient } from "./worker-client";
import type {
  ProjectChatToolCall,
  ProjectChatToolDefinition,
  ProjectChatToolExecution
} from "./project-chat-tools";

const SKILL_TOOL_PREFIX = "skill_local_";
const MAX_DYNAMIC_SKILLS = 100;
const MAX_FUNCTION_NAME_LENGTH = 64;
const MAX_DESCRIPTION_CHARACTERS = 1_000;
const MAX_TASK_CHARACTERS = 16_000;

type ProjectChatSkillClient = Pick<
  WorkerClient,
  "projectContext" | "invokeProjectSkill"
>;

type ProjectSkillSummary = ProjectContext["skills"][number];

type ProjectChatSkillRuntimeOptions = {
  client: ProjectChatSkillClient;
  onActivity?: (
    type: "job.started" | "job.succeeded" | "job.failed",
    title: string,
    detail: string
  ) => void;
};

export class ProjectChatSkillRuntime {
  constructor(private readonly options: ProjectChatSkillRuntimeOptions) {}

  isDynamicToolName(name: string): boolean {
    return name.startsWith(SKILL_TOOL_PREFIX);
  }

  async listDefinitions(localProjectId: string): Promise<ProjectChatToolDefinition[]> {
    const context = await this.options.client.projectContext(localProjectId);
    const definitions = new Map<string, ProjectChatToolDefinition>();
    for (const skill of context.skills) {
      const definition = toToolDefinition(skill);
      if (!definitions.has(definition.function.name)) {
        definitions.set(definition.function.name, definition);
      }
      if (definitions.size >= MAX_DYNAMIC_SKILLS) break;
    }
    return [...definitions.values()].sort((left, right) =>
      left.function.name.localeCompare(right.function.name)
    );
  }

  async execute(
    localProjectId: string,
    call: ProjectChatToolCall,
    signal?: AbortSignal
  ): Promise<ProjectChatToolExecution> {
    try {
      throwIfAborted(signal);
      const args = parseArguments(call.arguments);
      const task = requiredString(args.task, "task", MAX_TASK_CHARACTERS);
      const skill = await this.resolve(localProjectId, call.name);
      throwIfAborted(signal);
      return await this.runWithActivity(skill, async () => {
        const result = await this.options.client.invokeProjectSkill(
          localProjectId,
          skill.id,
          task
        );
        throwIfAborted(signal);
        return skillResult(result);
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        content: JSON.stringify({
          error: {
            code: readErrorCode(error),
            message: error instanceof Error ? error.message : "Unknown Skill Runtime error"
          }
        }),
        summary: error instanceof Error ? error.message : trMain("ui.2ac734e987b3"),
        isError: true
      };
    }
  }

  private async resolve(
    localProjectId: string,
    dynamicName: string
  ): Promise<ProjectSkillSummary> {
    const context = await this.options.client.projectContext(localProjectId);
    const skill = context.skills.find(
      (candidate) => dynamicToolName(candidate) === dynamicName
    );
    if (skill) return skill;
    const error = new Error("The project Skill is no longer available.");
    Object.assign(error, { code: "PROJECT_SKILL_NOT_AVAILABLE" });
    throw error;
  }

  private async runWithActivity(
    skill: ProjectSkillSummary,
    operation: () => Promise<ProjectChatToolExecution>
  ): Promise<ProjectChatToolExecution> {
    const title = trMain("ui.03a9e24c9bd1", [skill.name]);
    this.options.onActivity?.("job.started", title, skill.relativePath);
    try {
      const result = await operation();
      this.options.onActivity?.("job.succeeded", title, result.summary);
      return result;
    } catch (error) {
      this.options.onActivity?.(
        "job.failed",
        title,
        error instanceof Error ? error.message : "Unknown Skill Runtime error"
      );
      throw error;
    }
  }
}

function toToolDefinition(skill: ProjectSkillSummary): ProjectChatToolDefinition {
  const description = [
    `Load and apply the project Skill "${skill.name}" when the current task matches it.`,
    skill.description,
    "The returned instructions remain subject to platform safety, project boundaries, and approval policy."
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_DESCRIPTION_CHARACTERS);
  return {
    type: "function",
    function: {
      name: dynamicToolName(skill),
      description,
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The concrete current task that this Skill should guide."
          }
        },
        required: ["task"],
        additionalProperties: false
      }
    }
  };
}

function dynamicToolName(skill: ProjectSkillSummary): string {
  const hash = createHash("sha256")
    .update(`${skill.id}\0${skill.relativePath}`)
    .digest("hex")
    .slice(0, 12);
  const readable = sanitizeName(skill.id)
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_FUNCTION_NAME_LENGTH - SKILL_TOOL_PREFIX.length - hash.length - 1);
  return `${SKILL_TOOL_PREFIX}${readable || "skill"}_${hash}`.slice(
    0,
    MAX_FUNCTION_NAME_LENGTH
  );
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_");
}

function skillResult(
  result: LocalSkillInvocationResult
): ProjectChatToolExecution {
  return {
    content: JSON.stringify({
      skill_id: result.skillId,
      name: result.name,
      description: result.description,
      relative_path: result.relativePath,
      task: result.task,
      instructions: result.instructions,
      truncated: result.truncated,
      directive: result.directive
    }),
    summary: `${result.name} · ${result.instructions.length} characters`,
    isError: false
  };
}

function parseArguments(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    throw new Error("Skill arguments must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Skill arguments must be a JSON object.");
  }
  const keys = Object.keys(parsed);
  if (keys.some((key) => key !== "task")) {
    throw new Error("Skill arguments contain unsupported fields.");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string up to ${maxLength} characters.`);
  }
  if (value.includes("\0")) throw new Error(`${field} contains an invalid character.`);
  return value.trim();
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "LOCAL_SKILL_RUNTIME_ERROR";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("The project Skill operation was cancelled.");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
