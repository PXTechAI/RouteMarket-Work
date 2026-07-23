import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityStore } from "./activity-store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

describe("ActivityStore", () => {
  it("persists ordered activity history and redacts secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-activity-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const databasePath = join(root, "work.db");
    let store = new ActivityStore(databasePath);
    store.append({
      id: "activity_1",
      kind: "job.started",
      title: "Run",
      detail: "Authorization: Bearer abcdefghijklmnop",
      occurredAt: "2026-07-18T00:00:00.000Z"
    });
    store.append({
      id: "activity_2",
      kind: "job.succeeded",
      title: "Done",
      detail: "ok",
      occurredAt: "2026-07-18T00:00:01.000Z"
    });
    store.close();

    store = new ActivityStore(databasePath);
    expect(store.list()).toEqual([
      expect.objectContaining({ id: "activity_2", detail: "ok" }),
      expect.objectContaining({ id: "activity_1", detail: "Authorization: Bearer [REDACTED]" })
    ]);
    store.close();
  });

  it("groups repeated activity and can clear the history", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-activity-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const store = new ActivityStore(join(root, "work.db"));
    store.append({
      id: "activity_1",
      kind: "cloud.error",
      title: "Cloud Worker connection error",
      detail: "RouteMarket Work API request failed (502).",
      occurredAt: "2026-07-22T00:00:00.000Z"
    });
    store.append({
      id: "activity_2",
      kind: "cloud.error",
      title: "Cloud Worker connection error",
      detail: "RouteMarket Work API request failed (502).",
      occurredAt: "2026-07-22T00:00:30.000Z"
    });

    expect(store.list()).toEqual([
      expect.objectContaining({
        id: "activity_1",
        firstOccurredAt: "2026-07-22T00:00:00.000Z",
        occurredAt: "2026-07-22T00:00:30.000Z",
        occurrenceCount: 2
      })
    ]);
    store.clear();
    expect(store.list()).toEqual([]);
    store.close();
  });
});
