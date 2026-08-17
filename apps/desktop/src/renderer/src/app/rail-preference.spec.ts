import { describe, expect, it } from "vitest";
import {
  getCollapsedProjectIdsPreference,
  getCollapsedRailSectionsPreference,
  getRailExpandedPreference,
  setCollapsedProjectIdsPreference,
  setCollapsedRailSectionsPreference,
  setRailExpandedPreference
} from "./rail-preference";

describe("rail preference", () => {
  it("persists the expanded state in window storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(getRailExpandedPreference(storage)).toBe(false);
    setRailExpandedPreference(true, storage);
    expect(getRailExpandedPreference(storage)).toBe(true);
    setRailExpandedPreference(false, storage);
    expect(getRailExpandedPreference(storage)).toBe(false);
  });

  it("persists collapsed projects per account space", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    setCollapsedProjectIdsPreference("space-a", new Set(["project-1", "project-2"]), storage);

    expect([...getCollapsedProjectIdsPreference("space-a", storage)]).toEqual(["project-1", "project-2"]);
    expect(getCollapsedProjectIdsPreference("space-b", storage).size).toBe(0);
  });

  it("persists collapsed rail sections per account space", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    setCollapsedRailSectionsPreference("space-a", new Set(["recent", "projects"]), storage);

    expect([...getCollapsedRailSectionsPreference("space-a", storage)]).toEqual(["recent", "projects"]);
    expect(getCollapsedRailSectionsPreference("space-b", storage).size).toBe(0);
  });
});
