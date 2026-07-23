import type { ChatMessage } from "./types";

export function messagesBeforeEditedUser(
  messages: ChatMessage[],
  messageId: string
): ChatMessage[] {
  const index = messages.findIndex(
    (message) => message.id === messageId && message.role === "user"
  );
  if (index < 0) {
    throw new Error("The editable user message no longer exists.");
  }
  return messages.slice(0, index);
}
