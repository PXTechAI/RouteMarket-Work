import { trMain } from "./i18n";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  LocalTriggerInput,
  LocalTriggerKind,
  LocalTriggerSummary
} from "../shared/desktop-api";

type TriggerRow = {
  trigger_id: string;
  local_project_id: string;
  name: string;
  kind: LocalTriggerKind;
  enabled: number;
  relative_path: string | null;
  interval_minutes: number | null;
  accelerator: string | null;
  status: LocalTriggerSummary["status"];
  last_error: string | null;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
};

type HotkeyAdapter = {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
};

export type LocalTriggerEvent = {
  trigger: LocalTriggerSummary;
  reason: "file_changed" | "folder_added" | "schedule" | "hotkey" | "manual";
  relativePath: string | null;
  occurredAt: string;
};

export class LocalTriggerManager {
  private readonly db: DatabaseSync;
  private readonly disposers = new Map<string, () => void>();
  private readonly debounce = new Map<string, NodeJS.Timeout>();

  constructor(
    databasePath: string,
    private readonly resolveProjectRoot: (localProjectId: string) => Promise<string>,
    private readonly onFire: (event: LocalTriggerEvent) => void,
    private readonly hotkeys: HotkeyAdapter
  ) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_triggers (
        trigger_id TEXT PRIMARY KEY,
        local_project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        relative_path TEXT,
        interval_minutes REAL,
        accelerator TEXT,
        status TEXT NOT NULL,
        last_error TEXT,
        last_fired_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS local_triggers_project_idx
        ON local_triggers(local_project_id, updated_at DESC);
    `);
  }

  list(localProjectId?: string): LocalTriggerSummary[] {
    const rows = (localProjectId
      ? this.db.prepare("SELECT * FROM local_triggers WHERE local_project_id = ? ORDER BY updated_at DESC").all(localProjectId)
      : this.db.prepare("SELECT * FROM local_triggers ORDER BY updated_at DESC").all()) as TriggerRow[];
    return rows.map(mapRow);
  }

  get(triggerId: string): LocalTriggerSummary | null {
    const row = this.db.prepare("SELECT * FROM local_triggers WHERE trigger_id = ?").get(triggerId) as TriggerRow | undefined;
    return row ? mapRow(row) : null;
  }

  async save(input: LocalTriggerInput, triggerId?: string): Promise<LocalTriggerSummary> {
    const normalized = validateInput(input);
    await this.resolveProjectRoot(normalized.localProjectId);
    const existing = triggerId ? this.get(triggerId) : null;
    if (triggerId && !existing) throw new Error("Local trigger not found.");
    if (existing && existing.localProjectId !== normalized.localProjectId) {
      throw new Error("A local trigger cannot be moved between projects.");
    }
    const id = triggerId ?? `trigger_${randomUUID().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    this.disposeOne(id);
    this.db.prepare(`
      INSERT INTO local_triggers (
        trigger_id, local_project_id, name, kind, enabled, relative_path,
        interval_minutes, accelerator, status, last_error, last_fired_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inactive', NULL, ?, ?, ?)
      ON CONFLICT(trigger_id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        enabled = excluded.enabled,
        relative_path = excluded.relative_path,
        interval_minutes = excluded.interval_minutes,
        accelerator = excluded.accelerator,
        status = 'inactive',
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run(
      id,
      normalized.localProjectId,
      normalized.name,
      normalized.kind,
      normalized.enabled ? 1 : 0,
      normalized.relativePath ?? null,
      normalized.intervalMinutes ?? null,
      normalized.accelerator ?? null,
      existing?.lastFiredAt ?? null,
      existing?.createdAt ?? now,
      now
    );
    if (normalized.enabled) await this.activate(id);
    return this.get(id)!;
  }

  async remove(triggerId: string): Promise<void> {
    this.disposeOne(triggerId);
    this.db.prepare("DELETE FROM local_triggers WHERE trigger_id = ?").run(triggerId);
  }

  async startAll(): Promise<void> {
    await Promise.all(this.list().filter((trigger) => trigger.enabled).map((trigger) => this.activate(trigger.triggerId)));
  }

  async fire(triggerId: string, reason: LocalTriggerEvent["reason"] = "manual", relativePath: string | null = null): Promise<LocalTriggerSummary> {
    const trigger = this.get(triggerId);
    if (!trigger) throw new Error("Local trigger not found.");
    const occurredAt = new Date().toISOString();
    this.db.prepare("UPDATE local_triggers SET last_fired_at = ?, updated_at = ? WHERE trigger_id = ?")
      .run(occurredAt, occurredAt, triggerId);
    const next = this.get(triggerId)!;
    this.onFire({ trigger: next, reason, relativePath, occurredAt });
    return next;
  }

  close(): void {
    for (const triggerId of [...this.disposers.keys()]) this.disposeOne(triggerId);
    for (const timer of this.debounce.values()) clearTimeout(timer);
    this.debounce.clear();
    this.db.close();
  }

  private async activate(triggerId: string): Promise<void> {
    const trigger = this.get(triggerId);
    if (!trigger || !trigger.enabled) return;
    try {
      if (trigger.kind === "schedule") {
        const timer = setInterval(() => void this.fire(triggerId, "schedule"), trigger.intervalMinutes! * 60_000);
        timer.unref();
        this.disposers.set(triggerId, () => clearInterval(timer));
      } else if (trigger.kind === "hotkey") {
        if (!this.hotkeys.register(trigger.accelerator!, () => void this.fire(triggerId, "hotkey"))) {
          throw new Error(trMain("ui.b32b5d4d444a", [trigger.accelerator]));
        }
        this.disposers.set(triggerId, () => this.hotkeys.unregister(trigger.accelerator!));
      } else {
        const root = await this.resolveProjectRoot(trigger.localProjectId);
        const target = await safeTarget(root, trigger.relativePath ?? ".");
        const targetStat = await stat(target);
        const directory = targetStat.isDirectory() ? target : resolve(target, "..");
        const watchedFile = targetStat.isFile() ? relative(directory, target) : null;
        const watcher: FSWatcher = watch(directory, { recursive: true }, (eventType, filename) => {
          const changed = filename?.toString() ?? null;
          if (watchedFile && changed !== watchedFile) return;
          if (trigger.kind === "folder_added") {
            if (eventType !== "rename" || !changed) return;
            void stat(resolve(directory, changed)).then((item) => {
              if (item.isDirectory()) this.queueFire(triggerId, "folder_added", relative(root, resolve(directory, changed)));
            }).catch(() => undefined);
          } else {
            this.queueFire(triggerId, "file_changed", changed ? relative(root, resolve(directory, changed)) : trigger.relativePath);
          }
        });
        this.disposers.set(triggerId, () => watcher.close());
      }
      this.setRuntimeState(triggerId, "active", null);
    } catch (error) {
      this.setRuntimeState(triggerId, "error", error instanceof Error ? error.message : "Local trigger activation failed.");
    }
  }

  private queueFire(triggerId: string, reason: LocalTriggerEvent["reason"], relativePath: string | null): void {
    const current = this.debounce.get(triggerId);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      this.debounce.delete(triggerId);
      void this.fire(triggerId, reason, relativePath);
    }, 350);
    timer.unref();
    this.debounce.set(triggerId, timer);
  }

  private setRuntimeState(triggerId: string, status: LocalTriggerSummary["status"], lastError: string | null): void {
    this.db.prepare("UPDATE local_triggers SET status = ?, last_error = ? WHERE trigger_id = ?")
      .run(status, lastError, triggerId);
  }

  private disposeOne(triggerId: string): void {
    this.disposers.get(triggerId)?.();
    this.disposers.delete(triggerId);
    const timer = this.debounce.get(triggerId);
    if (timer) clearTimeout(timer);
    this.debounce.delete(triggerId);
  }
}

function validateInput(input: LocalTriggerInput): LocalTriggerInput {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Local trigger name must be 1-120 characters.");
  if (!(["file_changed", "folder_added", "schedule", "hotkey"] as LocalTriggerKind[]).includes(input.kind)) {
    throw new Error("Unsupported local trigger kind.");
  }
  const result: LocalTriggerInput = { localProjectId: input.localProjectId, name, kind: input.kind, enabled: Boolean(input.enabled) };
  if (input.kind === "file_changed" || input.kind === "folder_added") {
    const path = (input.relativePath ?? ".").trim().replaceAll("\\", "/");
    if (isAbsolute(path) || path.split("/").includes("..")) throw new Error("Trigger path must stay inside the project.");
    result.relativePath = path || ".";
  } else if (input.kind === "schedule") {
    const minutes = Number(input.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525_600) throw new Error("Schedule interval must be between 1 and 525600 minutes.");
    result.intervalMinutes = minutes;
  } else {
    const accelerator = (input.accelerator ?? "").trim();
    if (!accelerator || accelerator.length > 80) throw new Error("A valid shortcut is required.");
    result.accelerator = accelerator;
  }
  return result;
}

async function safeTarget(root: string, relativePath: string): Promise<string> {
  const target = resolve(root, relativePath);
  const realTarget = await realpath(target);
  const fromRoot = relative(resolve(root), realTarget);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Trigger path escapes the project root.");
  }
  return realTarget;
}

function mapRow(row: TriggerRow): LocalTriggerSummary {
  return {
    triggerId: row.trigger_id,
    localProjectId: row.local_project_id,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled === 1,
    relativePath: row.relative_path,
    intervalMinutes: row.interval_minutes,
    accelerator: row.accelerator,
    status: row.status,
    lastError: row.last_error,
    lastFiredAt: row.last_fired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
