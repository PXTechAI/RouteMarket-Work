import type { DesktopChatAttachment } from "../../../../shared/desktop-api";

export type ChatToolActivity = {
  toolCallId: string;
  toolName: string;
  title: string;
  status: "running" | "completed" | "error";
  detail?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sentAt: string;
  contextFile?: string;
  attachments?: DesktopChatAttachment[];
  stopped?: boolean;
  tools?: ChatToolActivity[];
  agentId?: string;
  agentRevision?: number;
  agentName?: string;
  agentAvatarUrl?: string | null;
};
