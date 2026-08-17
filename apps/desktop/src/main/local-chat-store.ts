import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DesktopChatAttachment,
  LocalProjectChat,
  LocalProjectChatMessage,
  LocalProjectChatSummary,
  ProjectChatArtifact,
  ProjectChatToolActivity
} from "../shared/desktop-api";

type MessageRow = {
  id: string;
  session_id: string;
  local_project_id: string | null;
  role: LocalProjectChatMessage["role"];
  content: string;
  reasoning_summary: string | null;
  sent_at: string;
  context_file: string | null;
  attachments_json: string | null;
  artifacts_json: string | null;
  tools_json: string | null;
  stopped: number;
  failed: number;
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
        local_project_id TEXT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        local_project_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        reasoning_summary TEXT,
        sent_at TEXT NOT NULL,
        context_file TEXT,
        attachments_json TEXT,
        artifacts_json TEXT,
        tools_json TEXT,
        stopped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        agent_id TEXT,
        agent_revision INTEGER,
        agent_name TEXT,
        agent_avatar_url TEXT,
        FOREIGN KEY (session_id) REFERENCES local_chat_threads(session_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS local_chat_messages_session_time
      ON local_chat_messages(session_id, sent_at, id);
    `);
    const threadSql = (this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'local_chat_threads'").get() as { sql?: string } | undefined)?.sql ?? "";
    if (/local_project_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(threadSql)) {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE local_chat_threads_next (
          session_id TEXT PRIMARY KEY,
          local_project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO local_chat_threads_next SELECT * FROM local_chat_threads;
        DROP TABLE local_chat_threads;
        ALTER TABLE local_chat_threads_next RENAME TO local_chat_threads;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS local_chat_threads_project_time ON local_chat_threads(local_project_id, updated_at DESC);");
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
    if (!messageColumns.has("reasoning_summary")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN reasoning_summary TEXT;");
    }
    if (!messageColumns.has("artifacts_json")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN artifacts_json TEXT;");
    }
    if (!messageColumns.has("failed")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN failed INTEGER NOT NULL DEFAULT 0;");
    }
    if (!messageColumns.has("tools_json")) {
      this.db.exec("ALTER TABLE local_chat_messages ADD COLUMN tools_json TEXT;");
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
    const messageForeignKeys = this.db.prepare("PRAGMA foreign_key_list(local_chat_messages)").all() as Array<{ table: string }>;
    if (messageForeignKeys.some((foreignKey) => foreignKey.table !== "local_chat_threads")) {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE local_chat_messages_next (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          local_project_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          reasoning_summary TEXT,
          sent_at TEXT NOT NULL,
          context_file TEXT,
          attachments_json TEXT,
          artifacts_json TEXT,
          tools_json TEXT,
          stopped INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          agent_id TEXT,
          agent_revision INTEGER,
          agent_name TEXT,
          agent_avatar_url TEXT,
          FOREIGN KEY (session_id) REFERENCES local_chat_threads(session_id) ON DELETE CASCADE
        );
        INSERT INTO local_chat_messages_next (
          id, session_id, local_project_id, role, content, reasoning_summary, sent_at, context_file,
          attachments_json, artifacts_json, tools_json, stopped, failed,
          agent_id, agent_revision, agent_name, agent_avatar_url
        )
        SELECT
          id, session_id, local_project_id, role, content, reasoning_summary, sent_at, context_file,
          attachments_json, artifacts_json, tools_json, stopped, failed,
          agent_id, agent_revision, agent_name, agent_avatar_url
        FROM local_chat_messages;
        DROP TABLE local_chat_messages;
        ALTER TABLE local_chat_messages_next RENAME TO local_chat_messages;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS local_chat_messages_session_time
        ON local_chat_messages(session_id, sent_at, id);
      `);
    }
    this.migrateNullableProjectScope();
  }

  private migrateNullableProjectScope(): void {
    const threadProjectColumn = (this.db.prepare("PRAGMA table_info(local_chat_threads)").all() as Array<{ name: string; notnull: number }>)
      .find((column) => column.name === "local_project_id");
    const messageProjectColumn = (this.db.prepare("PRAGMA table_info(local_chat_messages)").all() as Array<{ name: string; notnull: number }>)
      .find((column) => column.name === "local_project_id");
    if (threadProjectColumn?.notnull !== 1 && messageProjectColumn?.notnull !== 1) return;
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE local_chat_threads_scope_next (
        session_id TEXT PRIMARY KEY,
        local_project_id TEXT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO local_chat_threads_scope_next
      SELECT session_id, local_project_id, title, created_at, updated_at FROM local_chat_threads;
      CREATE TABLE local_chat_messages_scope_next (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        local_project_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        reasoning_summary TEXT,
        sent_at TEXT NOT NULL,
        context_file TEXT,
        attachments_json TEXT,
        artifacts_json TEXT,
        tools_json TEXT,
        stopped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        agent_id TEXT,
        agent_revision INTEGER,
        agent_name TEXT,
        agent_avatar_url TEXT,
        FOREIGN KEY (session_id) REFERENCES local_chat_threads_scope_next(session_id) ON DELETE CASCADE
      );
      INSERT INTO local_chat_messages_scope_next (
        id, session_id, local_project_id, role, content, reasoning_summary, sent_at, context_file,
        attachments_json, artifacts_json, tools_json, stopped, failed,
        agent_id, agent_revision, agent_name, agent_avatar_url
      )
      SELECT
        id, session_id, local_project_id, role, content, reasoning_summary, sent_at, context_file,
        attachments_json, artifacts_json, tools_json, stopped, failed,
        agent_id, agent_revision, agent_name, agent_avatar_url
      FROM local_chat_messages;
      DROP TABLE local_chat_messages;
      DROP TABLE local_chat_threads;
      ALTER TABLE local_chat_threads_scope_next RENAME TO local_chat_threads;
      ALTER TABLE local_chat_messages_scope_next RENAME TO local_chat_messages;
      COMMIT;
      PRAGMA foreign_keys = ON;
      CREATE INDEX IF NOT EXISTS local_chat_threads_project_time
      ON local_chat_threads(local_project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS local_chat_messages_session_time
      ON local_chat_messages(session_id, sent_at, id);
    `);
  }

  getOrCreate(localProjectId: string | null, title: string, sessionId?: string): LocalProjectChat {
    const existing = this.db.prepare(`
      SELECT session_id FROM local_chat_threads
      WHERE local_project_id IS ? ${sessionId ? "AND session_id = ?" : ""}
      ORDER BY updated_at DESC LIMIT 1
    `).get(...(sessionId ? [localProjectId, sessionId] : [localProjectId])) as { session_id: string } | undefined;
    const resolvedSessionId = existing?.session_id ?? sessionId ?? `local_chat_${randomUUID().replaceAll("-", "")}`;
    if (!existing) {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO local_chat_threads (session_id, local_project_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(resolvedSessionId, localProjectId, title.slice(0, 512), now, now);
    }
    return this.get(localProjectId, resolvedSessionId)!;
  }

  create(localProjectId: string | null, title: string): LocalProjectChatSummary {
    const chat = this.getOrCreate(localProjectId, title, `local_chat_${randomUUID().replaceAll("-", "")}`);
    return this.list(localProjectId).find((item) => item.sessionId === chat.sessionId)!;
  }

  rename(localProjectId: string | null, sessionId: string, title: string): LocalProjectChatSummary {
    const normalized = title.trim().slice(0, 512);
    if (!normalized) throw new Error("The conversation title cannot be empty.");
    const result = this.db.prepare(`
      UPDATE local_chat_threads SET title = ?, updated_at = ?
      WHERE local_project_id IS ? AND session_id = ?
    `).run(normalized, new Date().toISOString(), localProjectId, sessionId);
    if (Number(result.changes) !== 1) throw new Error("The conversation no longer exists.");
    return this.list(localProjectId).find((item) => item.sessionId === sessionId)!;
  }

  delete(localProjectId: string | null, sessionId: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        DELETE FROM local_chat_messages WHERE local_project_id IS ? AND session_id = ?
      `).run(localProjectId, sessionId);
      this.db.prepare(`
        DELETE FROM local_chat_threads WHERE local_project_id IS ? AND session_id = ?
      `).run(localProjectId, sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  move(localProjectId: string | null, sessionId: string, targetProjectId: string | null): LocalProjectChatSummary {
    if (localProjectId === targetProjectId) {
      const existing = this.list(localProjectId).find((item) => item.sessionId === sessionId);
      if (!existing) throw new Error("The conversation no longer exists.");
      return existing;
    }
    this.db.exec("BEGIN");
    try {
      const result = this.db.prepare(`
        UPDATE local_chat_threads SET local_project_id = ?, updated_at = ?
        WHERE local_project_id IS ? AND session_id = ?
      `).run(targetProjectId, new Date().toISOString(), localProjectId, sessionId);
      if (Number(result.changes) !== 1) throw new Error("The conversation no longer exists.");
      this.db.prepare(`
        UPDATE local_chat_messages SET local_project_id = ?
        WHERE local_project_id IS ? AND session_id = ?
      `).run(targetProjectId, localProjectId, sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.list(targetProjectId).find((item) => item.sessionId === sessionId)!;
  }

  list(localProjectId: string | null): LocalProjectChatSummary[] {
    return (this.db.prepare(`SELECT session_id, local_project_id, title, created_at, updated_at FROM local_chat_threads WHERE local_project_id IS ? ORDER BY updated_at DESC`).all(localProjectId) as Array<{ session_id: string; local_project_id: string | null; title: string; created_at: string; updated_at: string }>).map((row) => ({ sessionId: row.session_id, localProjectId: row.local_project_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  listRecent(limit = 12): LocalProjectChatSummary[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit || 12)));
    return (this.db.prepare(`SELECT session_id, local_project_id, title, created_at, updated_at FROM local_chat_threads ORDER BY updated_at DESC LIMIT ?`).all(boundedLimit) as Array<{ session_id: string; local_project_id: string | null; title: string; created_at: string; updated_at: string }>).map((row) => ({ sessionId: row.session_id, localProjectId: row.local_project_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  get(localProjectId: string | null, sessionId?: string): LocalProjectChat | null {
    const thread = this.db.prepare(`
      SELECT session_id, local_project_id FROM local_chat_threads
      WHERE local_project_id IS ? ${sessionId ? "AND session_id = ?" : ""}
      ORDER BY updated_at DESC LIMIT 1
    `).get(...(sessionId ? [localProjectId, sessionId] : [localProjectId])) as { session_id: string; local_project_id: string | null } | undefined;
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
        id, session_id, local_project_id, role, content, reasoning_summary, sent_at, context_file,
        attachments_json, artifacts_json, tools_json, stopped, failed,
        agent_id, agent_revision, agent_name, agent_avatar_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.sessionId,
      message.localProjectId,
      message.role,
      message.content,
      message.reasoning ?? null,
      message.sentAt,
      message.contextFile ?? null,
      message.attachments?.length
        ? JSON.stringify(message.attachments)
        : null,
      message.artifacts?.length
        ? JSON.stringify(message.artifacts)
        : null,
      message.tools?.length ? JSON.stringify(message.tools) : null,
      message.stopped ? 1 : 0,
      message.failed ? 1 : 0,
      message.agentId ?? null,
      message.agentRevision ?? null,
      message.agentName ?? null,
      message.agentAvatarUrl ?? null
    );
    this.db.prepare(`
      UPDATE local_chat_threads
      SET updated_at = ?, title = CASE
        WHEN ? = 'user' AND NOT EXISTS (
          SELECT 1 FROM local_chat_messages
          WHERE session_id = ? AND role = 'user' AND id <> ?
        ) THEN ?
        ELSE title
      END
      WHERE session_id = ?
    `).run(message.sentAt, message.role, message.sessionId, message.id, message.content.trim().slice(0, 80) || "New chat", message.sessionId);
  }

  truncateFrom(localProjectId: string | null, messageId: string): number {
    const target = this.db.prepare(`
      SELECT rowid AS message_rowid, session_id, role
      FROM local_chat_messages
      WHERE local_project_id IS ? AND id = ?
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
  const artifacts = parseArtifacts(row.artifacts_json);
  const tools = parseTools(row.tools_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    localProjectId: row.local_project_id,
    role: row.role,
    content: row.content,
    ...(row.reasoning_summary ? { reasoning: row.reasoning_summary } : {}),
    sentAt: row.sent_at,
    ...(row.context_file ? { contextFile: row.context_file } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(tools.length ? { tools } : {}),
    ...(row.stopped ? { stopped: true } : {}),
    ...(row.failed ? { failed: true } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.agent_revision ? { agentRevision: row.agent_revision } : {}),
    ...(row.agent_name ? { agentName: row.agent_name } : {}),
    ...(row.agent_avatar_url ? { agentAvatarUrl: row.agent_avatar_url } : {})
  };
}

function parseTools(value: string | null): ProjectChatToolActivity[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const tool = item as Record<string, unknown>;
      if (
        typeof tool.toolCallId !== "string" ||
        typeof tool.toolName !== "string" ||
        typeof tool.title !== "string" ||
        !["running", "completed", "error"].includes(String(tool.status))
      ) return [];
      return [{
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        title: tool.title,
        status: tool.status as ProjectChatToolActivity["status"],
        ...(typeof tool.detail === "string" ? { detail: tool.detail } : {})
      }];
    }).slice(0, 100);
  } catch {
    return [];
  }
}

function parseArtifacts(value: string | null): ProjectChatArtifact[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const artifact = item as Record<string, unknown>;
      if (
        artifact.kind !== "file" ||
        typeof artifact.id !== "string" ||
        typeof artifact.relativePath !== "string" ||
        typeof artifact.filename !== "string" ||
        typeof artifact.mimeType !== "string" ||
        typeof artifact.size !== "number" ||
        typeof artifact.uri !== "string" ||
        typeof artifact.providerId !== "string"
      ) return [];
      return [{
        id: artifact.id,
        kind: "file" as const,
        relativePath: artifact.relativePath,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        size: artifact.size,
        uri: artifact.uri,
        providerId: artifact.providerId
      }];
    }).slice(0, 20);
  } catch {
    return [];
  }
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
