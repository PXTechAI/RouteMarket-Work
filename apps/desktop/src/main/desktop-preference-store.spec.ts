import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopPreferenceStore, sanitizePreferences } from "./desktop-preference-store";

describe("DesktopPreferenceStore", () => {
  it("sanitizes persisted preferences", () => {
    expect(sanitizePreferences({
      locale: "zh-CN",
      theme: "dark",
      railExpanded: true,
      projectModels: { project_1: "deepseek-v4-flash", bad: 42 },
      token: "must-not-be-written"
    })).toEqual({
      locale: "zh-CN",
      theme: "dark",
      railExpanded: true,
      projectModels: { project_1: "deepseek-v4-flash" }
    });
  });

  it("writes settings.json and restores it", async () => {
    const root = await mkdtemp(join(tmpdir(), "routemarket-preferences-"));
    const filePath = join(root, "settings.json");
    const store = new DesktopPreferenceStore(filePath);
    await store.initialize();
    await store.update({ theme: "dark", locale: "system" });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      locale: "system",
      theme: "dark"
    });

    const restored = new DesktopPreferenceStore(filePath);
    await restored.initialize();
    expect(restored.get()).toEqual({ locale: "system", theme: "dark" });
  });

  it("accepts every supported desktop locale", () => {
    for (const locale of ["en-US", "zh-CN", "ja-JP", "es-ES", "pt-BR", "th-TH", "ko-KR"] as const) {
      expect(sanitizePreferences({ locale })).toEqual({ locale });
    }
  });
});
