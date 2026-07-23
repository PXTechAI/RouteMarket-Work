import { describe, expect, it } from "vitest";
import {
  getRailExpandedPreference,
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
});
