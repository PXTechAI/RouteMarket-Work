const RAIL_EXPANDED_KEY = "routemarket-work:rail-expanded";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function getRailExpandedPreference(
  storage: PreferenceStorage = window.localStorage
): boolean {
  return storage.getItem(RAIL_EXPANDED_KEY) === "true";
}

export function setRailExpandedPreference(
  expanded: boolean,
  storage: PreferenceStorage = window.localStorage
): void {
  storage.setItem(RAIL_EXPANDED_KEY, String(expanded));
}
