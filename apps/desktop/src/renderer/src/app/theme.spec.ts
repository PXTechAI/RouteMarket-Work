import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  getStoredThemePreference,
  setThemePreference,
  watchSystemTheme
} from "./theme";

let stored = new Map<string, string>();
let systemDark = false;
let changeListener: (() => void) | null = null;
const root = {
  dataset: {} as Record<string, string>,
  style: { colorScheme: "" }
};

beforeEach(() => {
  stored = new Map();
  systemDark = false;
  changeListener = null;
  root.dataset = {};
  root.style.colorScheme = "";
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    },
    matchMedia: () => ({
      matches: systemDark,
      addEventListener: (_event: string, listener: () => void) => {
        changeListener = listener;
      },
      removeEventListener: () => {
        changeListener = null;
      }
    })
  });
});

describe("theme preference", () => {
  it("defaults invalid preferences to the system theme", () => {
    expect(getStoredThemePreference()).toBe("system");
    stored.set("routemarket-work.theme", "sepia");
    expect(getStoredThemePreference()).toBe("system");
  });

  it("persists and immediately applies an explicit theme", () => {
    setThemePreference("dark");
    expect(stored.get("routemarket-work.theme")).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("follows and watches the operating-system theme", () => {
    systemDark = true;
    applyThemePreference("system");
    expect(root.dataset.theme).toBe("dark");

    const dispose = watchSystemTheme("system", () => {
      applyThemePreference("system");
    });
    systemDark = false;
    changeListener?.();
    expect(root.dataset.theme).toBe("light");
    dispose();
    expect(changeListener).toBeNull();
  });
});
