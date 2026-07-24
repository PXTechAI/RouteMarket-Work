import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DesktopChatAttachment,
  LocalProjectChat,
  LocalProjectChatMessage
} from "../shared/desktop-api";

type MessageRow = {
  id: string;
  session_id: string;
  local_project_id: string;
  role: LocalProjectChatMessage["role"];
  content: string;
  sent_at: string;
  context_file: string | null;
  attachments_json: string | null;
  stopped: number;
  agent_id: string | null;
  agent_revision: number | null;
  agent_name: string | null;
  agent_avatar_url: string | null;
};

export class LocalChatStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_chat_threads (
        session_id TEXT PRIMARY KEY,
        local_project_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        local_project_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        context_file TEXT,
        attachments_json TEXT,
        stopped INTEGER NOT NULL DEFAULT 0,
        agent_id TEXT,
        agent_revision INTEGER,
        agent_name TEXT,
        agent_avatar_url TEXT,
        FOREIGN KEY (session_id) REFERENCES local_chat_threads(session_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS local_chat_messages_session_time
      ON local_chat_messages(session_id, sent_at, id);
    `);
    const messageColumns = new Set(
      (this.db.prepare("PRAGMA table_info(local_chat_messages)").all() as Array<{ name: string }>)
        .map((column) => column.name)
    );
    if (!messageColumns.has("agent_id")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN agent_id TEXT;");
    }
    if (!messageColumns.has("attachments_json")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN attachments_json TEXT;");
    }
    if (!messageColumns.has("agent_name")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN agent_name TEXT;");
    }
    if (!messageColumns.has("agent_revision")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN agent_revision INTEGER;");
    }
    if (!messageColumns.has("agent_avatar_url")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN agent_avatar_url TEXT;");
    }
  }

  getOrCreate(localProjectId: string, title: string): LocalProjectChat {
    const existing = this.db.prepare(`
      SELECT session_id FROM local_chat_threads WHERE local_project_id = ? LIMIT 1
    `).get(localProjectId) as { session_id: string } | undefined;
    const sessionId = existing?.session_id ?? `local_chat_${randomUUID().replaceAll("-", "")}`;
    if (!existing) {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO local_chat_threads (session_id, local_project_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, localProjectId, title.slice(0, 512), now, now);
    }
    return this.get(localProjectId)!;
  }

  get(localProjectId: string): LocalProjectChat | null {
    const thread = this.db.prepare(`
      SELECT session_id, local_project_id FROM local_chat_threads
      WHERE local_project_id = ? LIMIT 1
    `).get(localProjectId) as { session_id: string; local_project_id: string } | undefined;
    if (!thread) return null;
    const rows = this.db.prepare(`
      SELECT * FROM local_chat_messages
      WHERE session_id = ? ORDER BY rowid ASC
    `).all(thread.session_id) as MessageRow[];
    return {
      sessionId: thread.session_id,
      localProjectId: thread.local_project_id,
      messages: rows.map(mapMessage)
    };
  }

  append(message: LocalProjectChatMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO local_chat_messages (
        id, session_id, local_project_id, role, content, sent_at, context_file,
        attachments_json, stopped,
        agent_id, agent_revision, agent_name, agent_avatar_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.sessionId,
      message.localProjectId,
      message.role,
      message.content,
      message.sentAt,
      message.contextFile ?? null,
      message.attachments?.length
        ? JSON.stringify(message.attachments)
        : null,
      message.stopped ? 1 : 0,
      message.agentId ?? null,
      message.agentRevision ?? null,
      message.agentName ?? null,
      message.agentAvatarUrl ?? null
    );
    this.db.prepare(`
      UPDATE local_chat_threads SET updated_at = ? WHERE session_id = ?
    `).run(message.sentAt, message.sessionId);
  }

  truncateFrom(localProjectId: string, messageId: string): number {
    const target = this.db.prepare(`
      SELECT rowid AS message_rowid, session_id, role
      FROM local_chat_messages
      WHERE local_project_id = ? AND id = ?
      LIMIT 1
    `).get(localProjectId, messageId) as {
      message_rowid: number;
      session_id: string;
      role: LocalProjectChatMessage["role"];
    } | undefined;
    if (!target) throw new Error("The chat message no longer exists.");
    if (target.role !== "user") throw new Error("Only user messages can be edited.");

    this.db.exec("BEGIN");
    try {
      const result = this.db.prepare(`
        DELETE FROM local_chat_messages
        WHERE session_id = ? AND rowid >= ?
      `).run(target.session_id, target.message_rowid);
      this.db.prepare(`
        UPDATE local_chat_threads
        SET updated_at = COALESCE(
          (SELECT MAX(sent_at) FROM local_chat_messages WHERE session_id = ?),
          created_at
        )
        WHERE session_id = ?
      `).run(target.session_id, target.session_id);
      this.db.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  deleteProject(localProjectId: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM local_chat_messages WHERE local_project_id = ?").run(localProjectId);
      this.db.prepare("DELETE FROM local_chat_threads WHERE local_project_id = ?").run(localProjectId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

function mapMessage(row: MessageRow): LocalProjectChatMessage {
  const attachments = parseAttachments(row.attachments_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    localProjectId: row.local_project_id,
    role: row.role,
    content: row.content,
    sentAt: row.sent_at,
    ...(row.context_file ? { contextFile: row.context_file } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(row.stopped ? { stopped: true } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.agent_revision ? { agentRevision: row.agent_revision } : {}),
    ...(row.agent_name ? { agentName: row.agent_name } : {}),
    ...(row.agent_avatar_url ? { agentAvatarUrl: row.agent_avatar_url } : {})
  };
}

function parseAttachments(value: string | null): DesktopChatAttachment[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const attachment = item as Record<string, unknown>;
      if (
        typeof attachment.id !== "string" ||
        typeof attachment.name !== "string" ||
        typeof attachment.mimeType !== "string" ||
        typeof attachment.size !== "number" ||
        !["image", "audio", "video", "file"].includes(String(attachment.kind)) ||
        typeof attachment.assetId !== "string" ||
        typeof attachment.downloadUrl !== "string"
      ) {
        return [];
      }
      return [{
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind as DesktopChatAttachment["kind"],
        textExcerpt:
          typeof attachment.textExcerpt === "string"
            ? attachment.textExcerpt
            : null,
        assetId: attachment.assetId,
        downloadUrl: attachment.downloadUrl,
        previewUrl:
          typeof attachment.previewUrl === "string"
            ? attachment.previewUrl
            : null
      }];
    }).slice(0, 5);
  } catch {
    return [];
  }
}
