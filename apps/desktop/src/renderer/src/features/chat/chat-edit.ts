import type { ChatMessage } from "./types";

export function messagesForEditedUserResend(
  messages: ChatMessage[],
  messageId: string
): ChatMessage[] {
  const messageExists = messages.some(
    (message) => message.id === messageId && message.role === "user"
  );
  if (!messageExists) {
    throw new Error("The editable user message no longer exists.");
  }
  return messages;
}
