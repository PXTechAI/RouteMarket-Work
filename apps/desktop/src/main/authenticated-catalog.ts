import type { DesktopAuthStatus } from "./desktop-auth-manager";

export async function loadAuthenticatedCatalog<T>(
  getAuthStatus: () => DesktopAuthStatus,
  load: () => Promise<T[]>,
  handleFailure?: (error: unknown) => Promise<boolean>
): Promise<T[]> {
  if (getAuthStatus() !== "signed_in") return [];
  try {
    return await load();
  } catch (error) {
    if (getAuthStatus() !== "signed_in") return [];
    if (await handleFailure?.(error)) return [];
    if (getAuthStatus() !== "signed_in") return [];
    throw error;
  }
}
