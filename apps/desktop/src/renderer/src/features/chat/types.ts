import type { DesktopChatAttachment, ProjectChatArtifact, ProjectChatResponseMeta, ProjectChatToolActivity } from "../../../../shared/desktop-api";

export type ChatToolActivity = ProjectChatToolActivity;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sentAt: string;
  contextFile?: string;
  attachments?: DesktopChatAttachment[];
  artifacts?: ProjectChatArtifact[];
  stopped?: boolean;
  failed?: boolean;
  tools?: ChatToolActivity[];
  responseMeta?: ProjectChatResponseMeta;
  agentId?: string;
  agentRevision?: number;
  agentName?: string;
  agentAvatarUrl?: string | null;
};
