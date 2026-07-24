import { describe, expect, it } from "vitest";
import type { DesktopWorkflowNodeDefinition } from "../../../../shared/desktop-api";
import {
  availableWorkflowSkills,
  workflowSkillById
} from "./workflow-skill-registry";

describe("workflow Skill registry", () => {
  it("discovers the Amazon Skill only when its required tools are available", () => {
    const skill = workflowSkillById("builtin.amazon-price-monitor");
    const definitions = skill.requiredExecutorKeys.map((executorKey) => ({
      executorKey,
      available: true
    })) as DesktopWorkflowNodeDefinition[];

    expect(availableWorkflowSkills(definitions).map((item) => item.id)).toEqual([
      skill.id
    ]);
    expect(availableWorkflowSkills(definitions.slice(1))).toEqual([]);
  });
});
