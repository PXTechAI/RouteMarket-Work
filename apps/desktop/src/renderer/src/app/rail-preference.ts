const RAIL_EXPANDED_KEY = "routemarket-work:rail-expanded";
const PROJECT_TREE_COLLAPSED_KEY = "routemarket-work:project-tree-collapsed";
const RAIL_SECTIONS_COLLAPSED_KEY = "routemarket-work:rail-sections-collapsed";

export type CollapsibleRailSection = "recent" | "projects";

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
  if (typeof window !== "undefined") {
    void window.routeMarketWork?.updatePreferences({ railExpanded: expanded });
  }
}

function projectTreePreferenceKey(scopeId: string): string {
  return `${PROJECT_TREE_COLLAPSED_KEY}:${scopeId || "guest"}`;
}

export function getCollapsedProjectIdsPreference(
  scopeId: string,
  storage: PreferenceStorage = window.localStorage
): Set<string> {
  try {
    const value = JSON.parse(storage.getItem(projectTreePreferenceKey(scopeId)) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function setCollapsedProjectIdsPreference(
  scopeId: string,
  projectIds: ReadonlySet<string>,
  storage: PreferenceStorage = window.localStorage
): void {
  storage.setItem(projectTreePreferenceKey(scopeId), JSON.stringify([...projectIds]));
}

function railSectionsPreferenceKey(scopeId: string): string {
  return `${RAIL_SECTIONS_COLLAPSED_KEY}:${scopeId || "guest"}`;
}

export function getCollapsedRailSectionsPreference(
  scopeId: string,
  storage: PreferenceStorage = window.localStorage
): Set<CollapsibleRailSection> {
  try {
    const value = JSON.parse(storage.getItem(railSectionsPreferenceKey(scopeId)) ?? "[]");
    return new Set(Array.isArray(value)
      ? value.filter((item): item is CollapsibleRailSection => item === "recent" || item === "projects")
      : []);
  } catch {
    return new Set();
  }
}

export function setCollapsedRailSectionsPreference(
  scopeId: string,
  sections: ReadonlySet<CollapsibleRailSection>,
  storage: PreferenceStorage = window.localStorage
): void {
  storage.setItem(railSectionsPreferenceKey(scopeId), JSON.stringify([...sections]));
}
