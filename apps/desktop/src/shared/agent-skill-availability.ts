import type {
  DesktopAgentSkill,
  ProjectContext
} from "./desktop-api";

export type DesktopAgentSkillStatus =
  | "available"
  | "disabled"
  | "cloud_runtime_unavailable"
  | "project_skill_missing"
  | "local_runtime_disabled";

export type DesktopAgentSkillAvailability = {
  skill: DesktopAgentSkill;
  status: DesktopAgentSkillStatus;
  available: boolean;
  reason: string | null;
  projectSkill: ProjectContext["skills"][number] | null;
};

export function resolveDesktopAgentSkillAvailability(
  skills: DesktopAgentSkill[],
  projectContext: ProjectContext | null,
  options: {
    executionEnvironment?: "local" | "cloud";
    localSkillToolsEnabled?: boolean;
  } = {}
): DesktopAgentSkillAvailability[] {
  return skills.map((skill) => {
    const projectSkill =
      projectContext?.skills.find((candidate) => candidate.id === skill.skillId) ??
      null;
    if (!skill.enabled) {
      return unavailable(skill, "disabled", "已在 Agent 配置中停用", projectSkill);
    }
    if (skill.source === "cloud") {
      return unavailable(
        skill,
        "cloud_runtime_unavailable",
        "云端 Skill 尚未接入 Desktop 本地运行时",
        projectSkill
      );
    }
    if (!projectSkill) {
      return unavailable(
        skill,
        "project_skill_missing",
        "当前项目未安装同 ID 的本地 Skill",
        null
      );
    }
    if (
      options.executionEnvironment === "cloud" ||
      options.localSkillToolsEnabled === false
    ) {
      return unavailable(
        skill,
        "local_runtime_disabled",
        options.executionEnvironment === "cloud"
          ? "当前选择云端执行，本地 Skill 不会发送给模型"
          : "项目 Skill 本地能力已关闭",
        projectSkill
      );
    }
    return {
      skill,
      status: "available",
      available: true,
      reason: null,
      projectSkill
    };
  });
}

function unavailable(
  skill: DesktopAgentSkill,
  status: Exclude<DesktopAgentSkillStatus, "available">,
  reason: string,
  projectSkill: ProjectContext["skills"][number] | null
): DesktopAgentSkillAvailability {
  return {
    skill,
    status,
    available: false,
    reason,
    projectSkill
  };
}
