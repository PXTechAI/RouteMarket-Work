import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopJob } from "@routemarket/work-protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeLocalSkillInvoke,
  invokeProjectSkill
} from "./local-skill-invoke";
import { projectBindingIdFor } from "./project-binding";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function createFixture(instructions = "Inspect the diff and report findings.") {
  const root = await mkdtemp(join(tmpdir(), "routemarket-skill-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  const skillRoot = join(projectRoot, ".routemarket", "skills", "review");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: Code review",
      "description: Review project changes safely.",
      "---",
      instructions
    ].join("\n"),
    "utf8"
  );
  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  return { registry, project, skillRoot };
}

function makeJob(localProjectId: string): DesktopJob {
  return {
    jobId: "djob_skill_test",
    workflowRunId: "workflow_skill_test",
    workflowNodeRunId: "node_skill_test",
    runtimeId: "runtime_skill_test",
    projectBindingId: projectBindingIdFor(localProjectId),
    executorKey: "local.skill.invoke",
    executorVersion: 1,
    input: {
      skillId: "review",
      task: "Review the current project changes."
    },
    requiredCapabilities: ["local.skill.invoke"],
    executionClass: "pure_read",
    approvalPolicy: {
      risk: "R0",
      mode: "project_grant"
    },
    idempotencyKey: `sha256:${createHash("sha256").update("skill-test").digest("hex")}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    maxInlineResultBytes: 262_144
  };
}

describe("local.skill.invoke", () => {
  it("loads a current project Skill for direct Chat or Agent use", async () => {
    const fixture = await createFixture();

    await expect(invokeProjectSkill(fixture.registry, {
      localProjectId: fixture.project.localProjectId,
      skillId: "review",
      task: "Review this change."
    })).resolves.toMatchObject({
      skillId: "review",
      name: "Code review",
      description: "Review project changes safely.",
      relativePath: ".routemarket/skills/review/SKILL.md",
      task: "Review this change.",
      instructions: expect.stringContaining("Inspect the diff"),
      truncated: false
    });
  });

  it("executes the same Runtime through a validated Desktop Job", async () => {
    const fixture = await createFixture();

    await expect(executeLocalSkillInvoke(
      fixture.registry,
      makeJob(fixture.project.localProjectId)
    )).resolves.toMatchObject({
      skillId: "review",
      task: "Review the current project changes.",
      instructions: expect.stringContaining("Inspect the diff")
    });
  });

  it("reloads Skill instructions on every invocation", async () => {
    const fixture = await createFixture("Initial instructions.");
    const first = await invokeProjectSkill(fixture.registry, {
      localProjectId: fixture.project.localProjectId,
      skillId: "review",
      task: "Review this."
    });
    await writeFile(
      join(fixture.skillRoot, "SKILL.md"),
      [
        "---",
        "name: Code review",
        "description: Review project changes safely.",
        "---",
        "Updated instructions."
      ].join("\n"),
      "utf8"
    );
    const second = await invokeProjectSkill(fixture.registry, {
      localProjectId: fixture.project.localProjectId,
      skillId: "review",
      task: "Review this."
    });

    expect(first.instructions).toContain("Initial instructions.");
    expect(second.instructions).toContain("Updated instructions.");
  });

  it("rejects removed Skills and invalid project bindings", async () => {
    const fixture = await createFixture();
    await rm(fixture.skillRoot, { recursive: true, force: true });

    await expect(invokeProjectSkill(fixture.registry, {
      localProjectId: fixture.project.localProjectId,
      skillId: "review",
      task: "Review this."
    })).rejects.toMatchObject({ code: "PROJECT_SKILL_NOT_AVAILABLE" });

    const invalid = makeJob(fixture.project.localProjectId);
    invalid.projectBindingId = projectBindingIdFor("project_other");
    await expect(executeLocalSkillInvoke(fixture.registry, invalid)).rejects.toMatchObject({
      code: "PROJECT_BINDING_INVALID"
    });
  });

  it("clips instructions to both the Runtime and Job result limits", async () => {
    const fixture = await createFixture("x".repeat(80 * 1024));
    const direct = await invokeProjectSkill(fixture.registry, {
      localProjectId: fixture.project.localProjectId,
      skillId: "review",
      task: "Review this."
    });
    expect(Buffer.byteLength(direct.instructions, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(direct.truncated).toBe(true);

    const job = makeJob(fixture.project.localProjectId);
    job.maxInlineResultBytes = 4_096;
    const result = await executeLocalSkillInvoke(fixture.registry, job);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(4_096);
    expect(result.truncated).toBe(true);
  });

  it("rejects expired Jobs and malformed tasks", async () => {
    const fixture = await createFixture();
    const expired = makeJob(fixture.project.localProjectId);
    expired.deadlineAt = new Date(Date.now() - 1_000).toISOString();

    await expect(executeLocalSkillInvoke(fixture.registry, expired)).rejects.toMatchObject({
      code: "JOB_DEADLINE_EXCEEDED"
    });
    await expect(invokeProjectSkill(fixture.registry, {
      localProjectId: fixture.project.localProjectId,
      skillId: "review",
      task: " "
    })).rejects.toMatchObject({ code: "SKILL_INPUT_INVALID" });
  });
});
