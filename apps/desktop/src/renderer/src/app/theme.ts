export type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "routemarket-work.theme";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function getStoredThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

export function setThemePreference(preference: ThemePreference) {
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyThemePreference(preference);
}

export function applyThemePreference(preference: ThemePreference) {
  const resolved =
    preference === "system"
      ? window.matchMedia(SYSTEM_DARK_QUERY).matches
        ? "dark"
        : "light"
      : preference;

  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function watchSystemTheme(
  preference: ThemePreference,
  onChange: () => void
) {
  if (preference !== "system") return () => undefined;
  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
