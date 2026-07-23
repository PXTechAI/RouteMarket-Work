import { describe, expect, it } from "vitest";
import { messagesBeforeEditedUser } from "./chat-edit";
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

describe("messagesBeforeEditedUser", () => {
  it("keeps only messages before the edited turn", () => {
    expect(messagesBeforeEditedUser(messages, "user:two")).toEqual(
      messages.slice(0, 2)
    );
  });

  it("can rewind the entire conversation", () => {
    expect(messagesBeforeEditedUser(messages, "user:one")).toEqual([]);
  });

  it("rejects assistant and unknown message ids", () => {
    expect(() =>
      messagesBeforeEditedUser(messages, "assistant:one")
    ).toThrow("editable user message");
    expect(() =>
      messagesBeforeEditedUser(messages, "user:missing")
    ).toThrow("editable user message");
  });
});
