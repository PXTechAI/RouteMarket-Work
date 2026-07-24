import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { LocalChatStore } from "./local-chat-store";

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe("LocalChatStore", () => {
  it("persists a project thread and restores its messages", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const databasePath = join(temporaryDirectory, "work.db");
    const first = new LocalChatStore(databasePath);
    const thread = first.getOrCreate("project_1", "Example");
    first.append({
      id: "user:request_1",
      sessionId: thread.sessionId,
      localProjectId: "project_1",
      role: "user",
      content: "Inspect this project",
      sentAt: "2026-07-23T04:00:00.000Z",
      attachments: [{
        id: "attachment_1",
        name: "requirements.md",
        mimeType: "text/markdown",
        size: 128,
        kind: "file",
        textExcerpt: "# Requirements",
        assetId: "asset_1",
        downloadUrl: "https://console.routemarket.ai/api/assets/asset_1",
        previewUrl: null
      }]
    });
    first.append({
      id: "assistant:request_1",
      sessionId: thread.sessionId,
      localProjectId: "project_1",
      role: "assistant",
      content: "The project looks healthy.",
      sentAt: "2026-07-23T04:00:00.000Z",
      agentId: "agent_builder",
      agentName: "Project Builder",
      agentAvatarUrl: "emoji:🛠️|bg:#4f46e5"
    });
    first.close();

    const restored = new LocalChatStore(databasePath);
    expect(restored.get("project_1")).toMatchObject({
      sessionId: thread.sessionId,
      messages: [
        {
          role: "user",
          content: "Inspect this project",
          attachments: [{
            id: "attachment_1",
            name: "requirements.md",
            assetId: "asset_1"
          }]
        },
        {
          role: "assistant",
          content: "The project looks healthy.",
          agentId: "agent_builder",
          agentName: "Project Builder",
          agentAvatarUrl: "emoji:🛠️|bg:#4f46e5"
        }
      ]
    });
    restored.close();
  });

  it("keeps local projects in separate threads", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const store = new LocalChatStore(join(temporaryDirectory, "work.db"));
    const first = store.getOrCreate("project_1", "First");
    const second = store.getOrCreate("project_2", "Second");
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(store.getOrCreate("project_1", "First").sessionId).toBe(first.sessionId);
    store.close();
  });

  it("migrates an existing chat database without losing old messages", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const databasePath = join(temporaryDirectory, "work.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE local_chat_threads (
        session_id TEXT PRIMARY KEY,
        local_project_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE local_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        local_project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        context_file TEXT,
        stopped INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO local_chat_threads VALUES (
        'session_legacy', 'project_legacy', 'Legacy',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
      INSERT INTO local_chat_messages VALUES (
        'user:legacy', 'session_legacy', 'project_legacy', 'user',
        'Keep this message', '2026-07-01T00:00:00.000Z', NULL, 0
      );
    `);
    legacy.close();

    const migrated = new LocalChatStore(databasePath);
    expect(migrated.get("project_legacy")?.messages).toEqual([
      expect.objectContaining({
        id: "user:legacy",
        content: "Keep this message"
      })
    ]);
    migrated.close();
  });

  it("rewinds a conversation from an edited user message", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const store = new LocalChatStore(join(temporaryDirectory, "work.db"));
    const thread = store.getOrCreate("project_1", "First");
    for (const [id, role, content] of [
      ["user:request_1", "user", "First question"],
      ["assistant:request_1", "assistant", "First answer"],
      ["user:request_2", "user", "Original second question"],
      ["assistant:request_2", "assistant", "Original second answer"]
    ] as const) {
      store.append({
        id,
        sessionId: thread.sessionId,
        localProjectId: "project_1",
        role,
        content,
        sentAt: `2026-07-23T04:00:0${store.get("project_1")!.messages.length}.000Z`
      });
    }

    expect(store.truncateFrom("project_1", "user:request_2")).toBe(2);
    expect(store.get("project_1")?.messages.map(({ id, content }) => ({ id, content })))
      .toEqual([
        { id: "user:request_1", content: "First question" },
        { id: "assistant:request_1", content: "First answer" }
      ]);
    expect(() =>
      store.truncateFrom("project_1", "assistant:request_1")
    ).toThrow("Only user messages can be edited.");
    store.close();
  });

  it("deletes project chat data without affecting other projects", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const store = new LocalChatStore(join(temporaryDirectory, "work.db"));
    store.getOrCreate("project_1", "First");
    store.getOrCreate("project_2", "Second");
    store.deleteProject("project_1");
    expect(store.get("project_1")).toBeNull();
    expect(store.get("project_2")).not.toBeNull();
    store.close();
  });
});
