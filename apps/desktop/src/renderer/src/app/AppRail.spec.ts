import { describe, expect, it } from "vitest";
import type { LocalProjectChatSummary } from "../../../shared/desktop-api";
import { getGeneralRecentChats } from "./AppRail";

function chat(sessionId: string, localProjectId: string | null): LocalProjectChatSummary {
  return {
    sessionId,
    localProjectId,
    title: sessionId,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z"
  };
}

describe("AppRail recent conversations", () => {
  it("shows only conversations that do not belong to a project", () => {
    const generalChat = chat("general", null);
    const projectChat = chat("project", "project_1");

    expect(getGeneralRecentChats([projectChat, generalChat])).toEqual([generalChat]);
  });
});
