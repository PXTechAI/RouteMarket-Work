const STORAGE_KEY = "routemarket-work.chat-models";

export function readProjectModelPreference(
  localProjectId: string,
  storage: Pick<Storage, "getItem"> = window.localStorage
): string | null {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>)[localProjectId];
    return typeof value === "string" && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export function writeProjectModelPreference(
  localProjectId: string,
  modelCode: string,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage
): void {
  let preferences: Record<string, string> = {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      preferences = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .slice(-99));
    }
  } catch {
    // Replace malformed local preferences with the current valid selection.
  }
  const nextPreferences = { ...preferences, [localProjectId]: modelCode };
  storage.setItem(STORAGE_KEY, JSON.stringify(nextPreferences));
  if (typeof window !== "undefined") {
    void window.routeMarketWork?.updatePreferences({ projectModels: nextPreferences });
  }
}
