import type {
  DesktopWorkflowDraft,
  DesktopWorkflowNodeDefinition
} from "../../../../shared/desktop-api";
import { AMAZON_PRICE_MONITOR_SKILL } from "./amazon-price-template";

export type WorkflowSkillSetupField = {
  key: string;
  kind: "text" | "url" | "directory";
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required: boolean;
};

export type WorkflowSkillDefinition = {
  id: string;
  version: number;
  name: string;
  description: string;
  requiredExecutorKeys: string[];
  setupFields: WorkflowSkillSetupField[];
  createDraft(input: {
    localProjectId: string;
    definitions: DesktopWorkflowNodeDefinition[];
    values: Record<string, string>;
  }): DesktopWorkflowDraft;
};

export const WORKFLOW_SKILLS: readonly WorkflowSkillDefinition[] = [
  AMAZON_PRICE_MONITOR_SKILL
];

export function workflowSkillById(skillId: string): WorkflowSkillDefinition {
  const skill = WORKFLOW_SKILLS.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error("Workflow Skill 不存在或已被移除。");
  return skill;
}

export function availableWorkflowSkills(
  definitions: DesktopWorkflowNodeDefinition[]
): WorkflowSkillDefinition[] {
  return WORKFLOW_SKILLS.filter((skill) =>
    skill.requiredExecutorKeys.every((executorKey) =>
      definitions.some(
        (definition) =>
          definition.executorKey === executorKey && definition.available
      )
    )
  );
}
