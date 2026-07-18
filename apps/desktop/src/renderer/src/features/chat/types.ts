export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sentAt: string;
  contextFile?: string;
  stopped?: boolean;
};
