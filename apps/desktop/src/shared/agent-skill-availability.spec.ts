import { describe, expect, it } from "vitest";
import type { DesktopAgentSkill, ProjectContext } from "./desktop-api";
import { resolveDesktopAgentSkillAvailability } from "./agent-skill-availability";

const context = {
  instructions: null,
  readme: null,
  settings: {
    defaultAgent: null,
    defaultModel: null,
    cloudProjectId: null,
    ignore: []
  },
  skills: [{
    id: "review",
    name: "Code review",
    description: "Review changes.",
    relativePath: ".routemarket/skills/review/SKILL.md"
  }]
} satisfies ProjectContext;

function skill(
  overrides: Partial<DesktopAgentSkill> = {}
): DesktopAgentSkill {
  return {
    skillId: "review",
    name: "Review",
    source: "local",
    enabled: true,
    ...overrides
  };
}

describe("resolveDesktopAgentSkillAvailability", () => {
  it("allows an enabled Agent Skill backed by the current project", () => {
    expect(resolveDesktopAgentSkillAvailability([skill()], context)[0])
      .toMatchObject({
        status: "available",
        available: true,
        reason: null,
        projectSkill: { id: "review" }
      });
  });

  it.each([
    {
      value: skill({ enabled: false }),
      status: "disabled",
      reason: "已在 Agent 配置中停用"
    },
    {
      value: skill({ source: "cloud" }),
      status: "cloud_runtime_unavailable",
      reason: "云端 Skill 尚未接入 Desktop 本地运行时"
    },
    {
      value: skill({ skillId: "missing" }),
      status: "project_skill_missing",
      reason: "当前项目未安装同 ID 的本地 Skill"
    }
  ])("reports $status instead of silently hiding it", ({ value, status, reason }) => {
    expect(resolveDesktopAgentSkillAvailability([value], context)[0])
      .toMatchObject({ status, available: false, reason });
  });

  it("reflects cloud execution and disabled local Skill tools", () => {
    expect(resolveDesktopAgentSkillAvailability(
      [skill()],
      context,
      { executionEnvironment: "cloud" }
    )[0]?.status).toBe("local_runtime_disabled");
    expect(resolveDesktopAgentSkillAvailability(
      [skill()],
      context,
      { localSkillToolsEnabled: false }
    )[0]).toMatchObject({
      status: "local_runtime_disabled",
      reason: "项目 Skill 本地能力已关闭"
    });
  });
});
