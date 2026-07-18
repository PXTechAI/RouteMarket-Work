import { describe, expect, it, vi } from "vitest";
import type { ProjectContext, ReadResult } from "../shared/desktop-api";
import { ProjectChatSkillRuntime } from "./project-chat-skill-tools";

const projectId = "project_1";

function skill(
  id: string,
  relativePath = `.routemarket/skills/${id}/SKILL.md`
): ProjectContext["skills"][number] {
  return {
    id,
    name: `Skill ${id}`,
    description: `Guidance for ${id}.`,
    relativePath
  };
}

function context(skills: ProjectContext["skills"]): ProjectContext {
  return {
    instructions: null,
    readme: null,
    settings: {
      defaultAgent: null,
      defaultModel: null,
      cloudProjectId: null,
      ignore: []
    },
    skills
  };
}

function readResult(text = "Follow these project instructions."): ReadResult {
  return {
    uri: "routemarket-work://project/project_1/.routemarket/skills/review/SKILL.md",
    text,
    bytesRead: Buffer.byteLength(text),
    truncated: false,
    encoding: "utf8",
    sha256: "a".repeat(64)
  };
}

function createClient(skills = [skill("review")]) {
  return {
    projectContext: vi.fn(async () => context(skills)),
    readProjectFile: vi.fn(async () => readResult())
  };
}

describe("ProjectChatSkillRuntime", () => {
  it("generates valid, stable and unique function definitions", async () => {
    const skills = [
      skill("review"),
      skill("review", ".routemarket/skills/review-v2/SKILL.md"),
      skill("设计 / 文档")
    ];
    const runtime = new ProjectChatSkillRuntime({ client: createClient(skills) });

    const first = await runtime.listDefinitions(projectId);
    const second = await runtime.listDefinitions(projectId);
    const names = first.map((definition) => definition.function.name);

    expect(first).toEqual(second);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names.every((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name))).toBe(true);
    expect(names.every((name) => name.startsWith("skill_local_"))).toBe(true);
    expect(first[0]?.function.parameters).toEqual({
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The concrete current task that this Skill should guide."
        }
      },
      required: ["task"],
      additionalProperties: false
    });
  });

  it("limits the model-visible Skill list to 100 definitions", async () => {
    const skills = Array.from({ length: 130 }, (_, index) =>
      skill(`skill_${index}`)
    );
    const runtime = new ProjectChatSkillRuntime({ client: createClient(skills) });

    await expect(runtime.listDefinitions(projectId)).resolves.toHaveLength(100);
  });

  it("reloads project context and reads the selected project Skill", async () => {
    const client = createClient();
    const runtime = new ProjectChatSkillRuntime({ client });
    const [definition] = await runtime.listDefinitions(projectId);

    const result = await runtime.execute(projectId, {
      id: "call_1",
      name: definition!.function.name,
      arguments: '{"task":"Review the current changes."}'
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      skill_id: "review",
      name: "Skill review",
      relative_path: ".routemarket/skills/review/SKILL.md",
      task: "Review the current changes.",
      instructions: "Follow these project instructions.",
      truncated: false
    });
    expect(client.projectContext).toHaveBeenCalledTimes(2);
    expect(client.readProjectFile).toHaveBeenCalledWith(
      projectId,
      ".routemarket/skills/review/SKILL.md"
    );
  });

  it("rejects a Skill removed after its schema was generated", async () => {
    const client = createClient();
    const runtime = new ProjectChatSkillRuntime({ client });
    const [definition] = await runtime.listDefinitions(projectId);
    client.projectContext.mockResolvedValue(context([]));

    const result = await runtime.execute(projectId, {
      id: "call_removed",
      name: definition!.function.name,
      arguments: '{"task":"Review this."}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({
      error: { code: "PROJECT_SKILL_NOT_AVAILABLE" }
    });
    expect(client.readProjectFile).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{", "Skill arguments must be valid JSON."],
    ["non-object JSON", "[]", "Skill arguments must be a JSON object."],
    ["missing task", "{}", "task must be a non-empty string"],
    [
      "unexpected field",
      '{"task":"Review","path":"other"}',
      "Skill arguments contain unsupported fields."
    ]
  ])("validates %s", async (_label, args, message) => {
    const client = createClient();
    const runtime = new ProjectChatSkillRuntime({ client });
    const [definition] = await runtime.listDefinitions(projectId);

    const result = await runtime.execute(projectId, {
      id: "call_invalid",
      name: definition!.function.name,
      arguments: args
    });

    expect(result.isError).toBe(true);
    expect(result.summary).toContain(message);
    expect(client.readProjectFile).not.toHaveBeenCalled();
  });

  it("clips Skill instructions to 64 KiB", async () => {
    const client = createClient();
    client.readProjectFile.mockResolvedValue(readResult("x".repeat(70 * 1024)));
    const runtime = new ProjectChatSkillRuntime({ client });
    const [definition] = await runtime.listDefinitions(projectId);

    const result = await runtime.execute(projectId, {
      id: "call_large",
      name: definition!.function.name,
      arguments: '{"task":"Apply this Skill."}'
    });
    const payload = JSON.parse(result.content);

    expect(payload.instructions).toHaveLength(64 * 1024);
    expect(payload.truncated).toBe(true);
  });

  it("preserves Worker error codes", async () => {
    const client = createClient();
    const workerError = new Error("Skill file is unavailable.");
    Object.assign(workerError, { code: "PROJECT_FILE_NOT_FOUND" });
    client.readProjectFile.mockRejectedValue(workerError);
    const runtime = new ProjectChatSkillRuntime({ client });
    const [definition] = await runtime.listDefinitions(projectId);

    const result = await runtime.execute(projectId, {
      id: "call_error",
      name: definition!.function.name,
      arguments: '{"task":"Apply this Skill."}'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      error: {
        code: "PROJECT_FILE_NOT_FOUND",
        message: "Skill file is unavailable."
      }
    });
  });

  it("honors cancellation before discovery and after reading", async () => {
    const client = createClient();
    const runtime = new ProjectChatSkillRuntime({ client });
    const [definition] = await runtime.listDefinitions(projectId);
    const before = new AbortController();
    before.abort();

    await expect(
      runtime.execute(
        projectId,
        {
          id: "call_before_abort",
          name: definition!.function.name,
          arguments: '{"task":"Apply this Skill."}'
        },
        before.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(client.projectContext).toHaveBeenCalledTimes(1);

    const after = new AbortController();
    client.readProjectFile.mockImplementation(async () => {
      after.abort();
      return readResult();
    });
    await expect(
      runtime.execute(
        projectId,
        {
          id: "call_after_abort",
          name: definition!.function.name,
          arguments: '{"task":"Apply this Skill."}'
        },
        after.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("emits activity events without requesting Tool Broker approval", async () => {
    const onActivity = vi.fn();
    const confirm = vi.fn();
    const client = { ...createClient(), confirm };
    const runtime = new ProjectChatSkillRuntime({ client, onActivity });
    const [definition] = await runtime.listDefinitions(projectId);

    const result = await runtime.execute(projectId, {
      id: "call_activity",
      name: definition!.function.name,
      arguments: '{"task":"Apply this Skill."}'
    });

    expect(result.isError).toBe(false);
    expect(onActivity).toHaveBeenNthCalledWith(
      1,
      "job.started",
      "加载 Skill：Skill review",
      ".routemarket/skills/review/SKILL.md"
    );
    expect(onActivity).toHaveBeenNthCalledWith(
      2,
      "job.succeeded",
      "加载 Skill：Skill review",
      expect.stringContaining("Skill review")
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});
