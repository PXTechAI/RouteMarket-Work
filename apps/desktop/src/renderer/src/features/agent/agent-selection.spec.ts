import { describe, expect, it } from "vitest";
import type { DesktopAgentProfile } from "../../../../shared/desktop-api";
import { selectAgentId } from "./agent-selection";

const agents = [
  createAgent("general"),
  createAgent("reviewer"),
  createAgent("designer")
];

describe("Agent selection", () => {
  it("uses the project's configured default Agent", () => {
    expect(
      selectAgentId({
        agents,
        defaultAgentId: "reviewer",
        currentAgentId: "general"
      })
    ).toBe("reviewer");
  });

  it("preserves a user's remembered selection for the project", () => {
    expect(
      selectAgentId({
        agents,
        rememberedAgentId: "designer",
        defaultAgentId: "reviewer",
        currentAgentId: "general"
      })
    ).toBe("designer");
  });

  it("falls back when configured selections are no longer available", () => {
    expect(
      selectAgentId({
        agents,
        rememberedAgentId: "removed",
        defaultAgentId: "missing",
        currentAgentId: "reviewer"
      })
    ).toBe("reviewer");
  });

  it("selects the first available Agent when no preference is valid", () => {
    expect(selectAgentId({ agents: agents.slice(0, 1) })).toBe("general");
    expect(selectAgentId({ agents: [] })).toBe("");
  });
});

function createAgent(id: string): DesktopAgentProfile {
  return {
    id,
    revision: 1,
    origin: "personal",
    forkSourceId: null,
    name: id,
    description: null,
    avatarUrl: null,
    systemPrompt: "",
    greeting: null,
    starterQuestions: [],
    tags: [],
    defaultModelCode: null,
    skills: [],
    toolPermissions: [],
    executionPolicy: { environment: "auto", approvalMode: "risky_only" },
    tools: [],
    updatedAt: "2026-07-19T00:00:00.000Z"
  };
}
