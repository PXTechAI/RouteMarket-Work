import type {
  DesktopPreferences,
  RouteMarketWorkApi
} from "../../../shared/desktop-api";

const LOCALE_KEY = "routemarket.work.locale";
const THEME_KEY = "routemarket-work.theme";
const RAIL_KEY = "routemarket-work:rail-expanded";
const PROJECT_MODELS_KEY = "routemarket-work.chat-models";

export async function hydrateDesktopPreferences(
  api: Pick<RouteMarketWorkApi, "getPreferences" | "updatePreferences">,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage
): Promise<DesktopPreferences> {
  const persisted = await api.getPreferences();
  const legacy = readLegacyPreferences(storage);
  const merged: DesktopPreferences = {
    locale: persisted.locale ?? legacy.locale,
    theme: persisted.theme ?? legacy.theme,
    railExpanded: persisted.railExpanded ?? legacy.railExpanded,
    projectModels: persisted.projectModels ?? legacy.projectModels
  };
  const normalized = Object.fromEntries(
    Object.entries(merged).filter((entry) => entry[1] !== undefined)
  ) as DesktopPreferences;

  if (JSON.stringify(normalized) !== JSON.stringify(persisted)) {
    await api.updatePreferences(normalized);
  }
  mirrorPreferencesToLegacyStorage(normalized, storage);
  return normalized;
}

function readLegacyPreferences(
  storage: Pick<Storage, "getItem">
): DesktopPreferences {
  const locale = storage.getItem(LOCALE_KEY);
  const theme = storage.getItem(THEME_KEY);
  const railExpanded = storage.getItem(RAIL_KEY);
  const result: DesktopPreferences = {};
  if (
    locale === "system" || locale === "en-US" || locale === "zh-CN" ||
    locale === "ja-JP" || locale === "es-ES" || locale === "pt-BR" ||
    locale === "th-TH" || locale === "ko-KR"
  ) result.locale = locale;
  if (theme === "system" || theme === "light" || theme === "dark") result.theme = theme;
  if (railExpanded === "true" || railExpanded === "false") {
    result.railExpanded = railExpanded === "true";
  }
  try {
    const models = JSON.parse(storage.getItem(PROJECT_MODELS_KEY) ?? "{}");
    if (models && typeof models === "object" && !Array.isArray(models)) {
      result.projectModels = Object.fromEntries(
        Object.entries(models as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .slice(-100)
      );
    }
  } catch {
    // Ignore malformed Chromium preferences; the main process validates file-backed settings.
  }
  return result;
}

function mirrorPreferencesToLegacyStorage(
  preferences: DesktopPreferences,
  storage: Pick<Storage, "setItem">
): void {
  if (preferences.locale) storage.setItem(LOCALE_KEY, preferences.locale);
  if (preferences.theme) storage.setItem(THEME_KEY, preferences.theme);
  if (preferences.railExpanded !== undefined) {
    storage.setItem(RAIL_KEY, String(preferences.railExpanded));
  }
  if (preferences.projectModels) {
    storage.setItem(PROJECT_MODELS_KEY, JSON.stringify(preferences.projectModels));
  }
}
