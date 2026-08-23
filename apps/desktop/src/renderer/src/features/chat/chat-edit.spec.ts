import { describe, expect, it } from "vitest";
import { messagesForEditedUserResend } from "./chat-edit";
import type { ChatMessage } from "./types";

const messages: ChatMessage[] = [
  {
    id: "user:one",
    role: "user",
    content: "First",
    sentAt: "2026-07-24T00:00:00.000Z"
  },
  {
    id: "assistant:one",
    role: "assistant",
    content: "Answer",
    sentAt: "2026-07-24T00:00:01.000Z"
  },
  {
    id: "user:two",
    role: "user",
    content: "Second",
    sentAt: "2026-07-24T00:00:02.000Z"
  },
  {
    id: "assistant:two",
    role: "assistant",
    content: "Another answer",
    sentAt: "2026-07-24T00:00:03.000Z"
  }
];

describe("messagesForEditedUserResend", () => {
  it("keeps the entire conversation when resending an edited message", () => {
    expect(messagesForEditedUserResend(messages, "user:two")).toBe(messages);
  });

  it("keeps history when resending the first message", () => {
    expect(messagesForEditedUserResend(messages, "user:one")).toBe(messages);
  });

  it("rejects assistant and unknown message ids", () => {
    expect(() =>
      messagesForEditedUserResend(messages, "assistant:one")
    ).toThrow("editable user message");
    expect(() =>
      messagesForEditedUserResend(messages, "user:missing")
    ).toThrow("editable user message");
  });
});
