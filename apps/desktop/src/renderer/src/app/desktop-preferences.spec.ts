import { describe, expect, it, vi } from "vitest";
import { hydrateDesktopPreferences } from "./desktop-preferences";

describe("hydrateDesktopPreferences", () => {
  it("imports legacy Chromium preferences when settings.json is empty", async () => {
    const values = new Map<string, string>([
      ["routemarket.work.locale", "zh-CN"],
      ["routemarket-work.theme", "dark"],
      ["routemarket-work:rail-expanded", "true"],
      ["routemarket-work.chat-models", JSON.stringify({ project_1: "deepseek-v4-flash" })]
    ]);
    const updatePreferences = vi.fn(async (patch) => patch);
    const result = await hydrateDesktopPreferences({
      getPreferences: async () => ({}),
      updatePreferences
    }, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    });

    expect(result).toEqual({
      locale: "zh-CN",
      theme: "dark",
      railExpanded: true,
      projectModels: { project_1: "deepseek-v4-flash" }
    });
    expect(updatePreferences).toHaveBeenCalledWith(result);
  });

  it("prefers file-backed settings and mirrors them for synchronous consumers", async () => {
    const values = new Map<string, string>([["routemarket-work.theme", "light"]]);
    await hydrateDesktopPreferences({
      getPreferences: async () => ({ theme: "dark" }),
      updatePreferences: async (patch) => patch
    }, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    });
    expect(values.get("routemarket-work.theme")).toBe("dark");
  });
});
