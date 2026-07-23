import { describe, expect, it } from "vitest";
import type { DesktopAgentProfile } from "../../../../shared/desktop-api";
import { resolveConversationAgentVersion } from "./agent-version";
import type { ChatMessage } from "./types";

const currentAgent = {
  id: "agent_1",
  revision: 4,
  name: "Current Agent",
  avatarUrl: "https://example.test/current.png"
} as DesktopAgentProfile;

function assistant(
  revision: number,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id: `assistant_${revision}`,
    role: "assistant",
    content: "Done",
    sentAt: "2026-07-24T00:00:00.000Z",
    agentId: "agent_1",
    agentRevision: revision,
    agentName: `Agent v${revision}`,
    agentAvatarUrl: `https://example.test/v${revision}.png`,
    ...overrides
  };
}

describe("resolveConversationAgentVersion", () => {
  it("uses the current version for a new conversation", () => {
    expect(resolveConversationAgentVersion([], currentAgent)).toEqual({
      activeRevision: 4,
      currentRevision: 4,
      name: "Current Agent",
      avatarUrl: "https://example.test/current.png",
      updateAvailable: false
    });
  });

  it("keeps a restored conversation pinned and reports a newer version", () => {
    expect(resolveConversationAgentVersion([assistant(2)], currentAgent)).toEqual({
      activeRevision: 2,
      currentRevision: 4,
      name: "Agent v2",
      avatarUrl: "https://example.test/v2.png",
      updateAvailable: true
    });
  });

  it("adopts the current version without rewriting the old snapshot", () => {
    expect(resolveConversationAgentVersion([assistant(2)], currentAgent, 4)).toEqual({
      activeRevision: 4,
      currentRevision: 4,
      name: "Current Agent",
      avatarUrl: "https://example.test/current.png",
      updateAvailable: false
    });
  });

  it("does not inherit a snapshot when the user switches agents", () => {
    expect(
      resolveConversationAgentVersion(
        [assistant(2, { agentId: "agent_other" })],
        currentAgent
      )
    ).toMatchObject({
      activeRevision: 4,
      currentRevision: 4,
      updateAvailable: false
    });
  });
});
