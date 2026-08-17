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
      reasoning: "Checked the project structure and verification results.",
      sentAt: "2026-07-23T04:00:00.000Z",
      artifacts: [{
        id: "artifact_1",
        kind: "file",
        relativePath: "report.xlsx",
        filename: "report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 4096,
        uri: "project://project_1/report.xlsx",
        providerId: "ai.routemarket.spreadsheet"
      }],
      tools: [{
        toolCallId: "tool_1",
        toolName: "spreadsheet",
        title: "Create spreadsheet",
        status: "completed",
        detail: "Created report.xlsx"
      }],
      agentId: "agent_builder",
      failed: true,
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
          reasoning: "Checked the project structure and verification results.",
          agentId: "agent_builder",
          failed: true,
          agentName: "Project Builder",
          agentAvatarUrl: "emoji:🛠️|bg:#4f46e5",
          artifacts: [{
            id: "artifact_1",
            relativePath: "report.xlsx",
            filename: "report.xlsx"
          }],
          tools: [{
            toolCallId: "tool_1",
            toolName: "spreadsheet",
            status: "completed"
          }]
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

  it("keeps multiple independent chats under one project", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const store = new LocalChatStore(join(temporaryDirectory, "work.db"));
    const first = store.create("project_1", "First chat");
    const second = store.create("project_1", "Second chat");

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(store.list("project_1")).toHaveLength(2);
    expect(store.get("project_1", first.sessionId)?.messages).toEqual([]);
    expect(store.get("project_1", second.sessionId)?.messages).toEqual([]);
    store.close();
  });

  it("persists general chats and moves them into and out of projects", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const databasePath = join(temporaryDirectory, "work.db");
    const store = new LocalChatStore(databasePath);
    const chat = store.create(null, "General chat");
    store.append({
      id: "user:general",
      sessionId: chat.sessionId,
      localProjectId: null,
      role: "user",
      content: "A conversation without a project",
      sentAt: "2026-08-15T00:00:00.000Z"
    });

    expect(store.list(null)).toEqual([expect.objectContaining({
      sessionId: chat.sessionId,
      localProjectId: null
    })]);
    expect(store.listRecent()).toEqual([expect.objectContaining({ sessionId: chat.sessionId })]);
    expect(store.move(null, chat.sessionId, "project_1").localProjectId).toBe("project_1");
    expect(store.get("project_1", chat.sessionId)?.messages[0]?.localProjectId).toBe("project_1");
    expect(store.move("project_1", chat.sessionId, null).localProjectId).toBeNull();
    store.close();

    const restored = new LocalChatStore(databasePath);
    expect(restored.get(null, chat.sessionId)?.messages[0]).toMatchObject({
      localProjectId: null,
      content: "A conversation without a project"
    });
    restored.close();
  });

  it("renames, moves and deletes an individual chat with its messages", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const store = new LocalChatStore(join(temporaryDirectory, "work.db"));
    const chat = store.create("project_1", "Draft title");
    store.append({
      id: "user:move",
      sessionId: chat.sessionId,
      localProjectId: "project_1",
      role: "user",
      content: "Keep this message",
      sentAt: "2026-08-13T00:00:00.000Z"
    });

    expect(store.rename("project_1", chat.sessionId, "Renamed").title).toBe("Renamed");
    expect(store.move("project_1", chat.sessionId, "project_2")).toMatchObject({
      sessionId: chat.sessionId,
      localProjectId: "project_2",
      title: "Renamed"
    });
    expect(store.get("project_1", chat.sessionId)).toBeNull();
    expect(store.get("project_2", chat.sessionId)?.messages[0]).toMatchObject({
      localProjectId: "project_2",
      content: "Keep this message"
    });
    store.delete("project_2", chat.sessionId);
    expect(store.get("project_2", chat.sessionId)).toBeNull();
    store.close();
  });

  it("migrates an existing chat database without losing old messages", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const databasePath = join(temporaryDirectory, "work.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
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
        stopped INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES local_chat_threads(session_id) ON DELETE CASCADE
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
    expect(migrated.create("project_legacy", "New chat").sessionId).not.toBe("session_legacy");
    expect(migrated.list("project_legacy")).toHaveLength(2);
    migrated.close();
  });

  it("repairs the broken foreign key left by the previous migration", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-local-chat-"));
    const databasePath = join(temporaryDirectory, "work.db");
    const broken = new DatabaseSync(databasePath);
    broken.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE local_chat_threads (
        session_id TEXT PRIMARY KEY,
        local_project_id TEXT NOT NULL,
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
        stopped INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES local_chat_threads_legacy(session_id) ON DELETE CASCADE
      );
      INSERT INTO local_chat_threads VALUES (
        'session_broken', 'project_broken', 'Broken migration',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
      INSERT INTO local_chat_messages VALUES (
        'user:broken', 'session_broken', 'project_broken', 'user',
        'Recover this message', '2026-07-01T00:00:00.000Z', NULL, 0
      );
    `);
    broken.close();

    const repaired = new LocalChatStore(databasePath);
    expect(repaired.get("project_broken")?.messages).toEqual([
      expect.objectContaining({ id: "user:broken", content: "Recover this message" })
    ]);
    repaired.close();

    const verified = new DatabaseSync(databasePath);
    expect(verified.prepare("PRAGMA foreign_key_list(local_chat_messages)").all()).toEqual([
      expect.objectContaining({ table: "local_chat_threads" })
    ]);
    verified.close();
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
