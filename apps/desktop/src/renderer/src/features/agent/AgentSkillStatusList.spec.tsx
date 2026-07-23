import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesktopAgentSkillAvailability } from "../../../../shared/agent-skill-availability";
import { AgentSkillStatusList } from "./AgentSkillStatusList";

describe("AgentSkillStatusList", () => {
  it("renders available and unavailable Skills with an explanation", () => {
    const items: DesktopAgentSkillAvailability[] = [
      {
        skill: {
          skillId: "review",
          name: "Code review",
          source: "local",
          enabled: true
        },
        status: "available",
        available: true,
        reason: null,
        projectSkill: {
          id: "review",
          name: "Code review",
          description: "Review changes.",
          relativePath: ".routemarket/skills/review/SKILL.md"
        }
      },
      {
        skill: {
          skillId: "research",
          name: "Cloud research",
          source: "cloud",
          enabled: true
        },
        status: "cloud_runtime_unavailable",
        available: false,
        reason: "云端 Skill 尚未接入 Desktop 本地运行时",
        projectSkill: null
      }
    ];

    const html = renderToStaticMarkup(
      <AgentSkillStatusList items={items} compact />
    );

    expect(html).toContain("1 可用 · 1 不可用");
    expect(html).toContain("Code review");
    expect(html).toContain(".routemarket/skills/review/SKILL.md");
    expect(html).toContain("云端 Skill 尚未接入 Desktop 本地运行时");
  });
});
