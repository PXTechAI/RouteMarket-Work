import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalTriggerManager, type LocalTriggerEvent } from "./local-trigger-manager";

describe("LocalTriggerManager", () => {
  let directory: string;
  let events: LocalTriggerEvent[];
  let registered: Map<string, () => void>;
  let manager: LocalTriggerManager;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "routemarket-trigger-"));
    events = [];
    registered = new Map();
    manager = new LocalTriggerManager(
      join(directory, "work.db"),
      async (projectId) => {
        if (projectId !== "project_test") throw new Error("Project not found");
        return directory;
      },
      (event) => events.push(event),
      {
        register(accelerator, callback) {
          if (registered.has(accelerator)) return false;
          registered.set(accelerator, callback);
          return true;
        },
        unregister(accelerator) { registered.delete(accelerator); }
      }
    );
  });

  afterEach(async () => {
    manager.close();
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists and updates a disabled file trigger", async () => {
    const created = await manager.save({
      localProjectId: "project_test",
      name: "Source changed",
      kind: "file_changed",
      enabled: false,
      relativePath: "src"
    });
    expect(created.status).toBe("inactive");
    expect(manager.list("project_test")).toHaveLength(1);

    const updated = await manager.save({
      localProjectId: created.localProjectId,
      name: "Source files changed",
      kind: created.kind,
      enabled: false,
      relativePath: created.relativePath ?? undefined
    }, created.triggerId);
    expect(updated.name).toBe("Source files changed");
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it("rejects paths outside the project", async () => {
    await expect(manager.save({
      localProjectId: "project_test",
      name: "Unsafe",
      kind: "file_changed",
      enabled: false,
      relativePath: "../secrets"
    })).rejects.toThrow("inside the project");
  });

  it("registers, fires, and unregisters a hotkey", async () => {
    const trigger = await manager.save({
      localProjectId: "project_test",
      name: "Quick run",
      kind: "hotkey",
      enabled: true,
      accelerator: "CommandOrControl+Shift+R"
    });
    expect(trigger.status).toBe("active");
    registered.get("CommandOrControl+Shift+R")?.();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]?.reason).toBe("hotkey");

    await manager.remove(trigger.triggerId);
    expect(registered.size).toBe(0);
    expect(manager.list()).toHaveLength(0);
  });

  it("records manual fire time", async () => {
    const trigger = await manager.save({
      localProjectId: "project_test",
      name: "Manual test",
      kind: "schedule",
      enabled: false,
      intervalMinutes: 10
    });
    const fired = await manager.fire(trigger.triggerId);
    expect(fired.lastFiredAt).not.toBeNull();
    expect(events[0]).toMatchObject({ reason: "manual", relativePath: null });
  });
});
