import type { DesktopAgentProfile } from "../../../../shared/desktop-api";
import type { ChatMessage } from "./types";

export type ConversationAgentVersion = {
  activeRevision: number;
  currentRevision: number;
  name: string;
  avatarUrl: string | null;
  updateAvailable: boolean;
};

export function resolveConversationAgentVersion(
  messages: ChatMessage[],
  agent: DesktopAgentProfile | null,
  adoptedRevision?: number
): ConversationAgentVersion | null {
  if (!agent) return null;

  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.agentId === agent.id);
  const latestConversationRevision =
    messages.at(-1)?.agentId === agent.id
      ? latestAssistant?.agentRevision
      : undefined;
  const activeRevision =
    adoptedRevision ?? latestConversationRevision ?? agent.revision;
  const usesStoredSnapshot =
    latestAssistant?.agentRevision === activeRevision;

  return {
    activeRevision,
    currentRevision: agent.revision,
    name:
      usesStoredSnapshot && latestAssistant?.agentName
        ? latestAssistant.agentName
        : agent.name,
    avatarUrl:
      usesStoredSnapshot && latestAssistant && "agentAvatarUrl" in latestAssistant
        ? latestAssistant.agentAvatarUrl ?? null
        : agent.avatarUrl,
    updateAvailable: agent.revision > activeRevision
  };
}
