import { describe, expect, it } from "vitest";
import { readProjectModelPreference, writeProjectModelPreference } from "./model-preference";

describe("project chat model preference", () => {
  it("persists independent model choices per project", () => {
    let value: string | null = null;
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    writeProjectModelPreference("project_1", "deepseek-v4-flash", storage);
    writeProjectModelPreference("project_2", "claude-fable-5", storage);
    expect(readProjectModelPreference("project_1", storage)).toBe("deepseek-v4-flash");
    expect(readProjectModelPreference("project_2", storage)).toBe("claude-fable-5");
  });
});
