import { tr } from "../../i18n";
import type {
  DesktopWorkflowDraft,
  DesktopWorkflowNodeDefinition,
  LocalTriggerInput,
} from "../../../../shared/desktop-api";
import { getAmazonPriceMonitorSkill } from "./amazon-price-template";
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
  createTrigger?(input: {
    localProjectId: string;
    draft: DesktopWorkflowDraft;
    values: Record<string, string>;
  }): LocalTriggerInput;
};
export function workflowSkills(): readonly WorkflowSkillDefinition[] {
  return [getAmazonPriceMonitorSkill()];
}
export function workflowSkillById(skillId: string): WorkflowSkillDefinition {
  const skill = workflowSkills().find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(tr("ui.151c949223c2"));
  return skill;
}
export function availableWorkflowSkills(definitions: DesktopWorkflowNodeDefinition[]): WorkflowSkillDefinition[] {
  return workflowSkills().filter((skill) =>
    skill.requiredExecutorKeys.every((executorKey) =>
      definitions.some((definition) => definition.executorKey === executorKey && definition.available),
    ),
  );
}
