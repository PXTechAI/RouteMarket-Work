import { describe, expect, it, vi } from "vitest";
import type { DesktopAuthStatus } from "./desktop-auth-manager";
import { loadAuthenticatedCatalog } from "./authenticated-catalog";

describe("loadAuthenticatedCatalog", () => {
  it("does not start a catalog request while signed out", async () => {
    const load = vi.fn<() => Promise<string[]>>();
    await expect(loadAuthenticatedCatalog(() => "signed_out", load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("absorbs an invalid-session failure when sign-out wins the request race", async () => {
    let authStatus: DesktopAuthStatus = "signed_in";
    const load = vi.fn(async () => {
      authStatus = "signed_out";
      throw new Error("Invalid session");
    });

    await expect(loadAuthenticatedCatalog(() => authStatus, load)).resolves.toEqual([]);
  });

  it("preserves catalog errors while the session is still signed in", async () => {
    const error = new Error("Catalog unavailable");
    await expect(loadAuthenticatedCatalog(
      () => "signed_in",
      async () => { throw error; }
    )).rejects.toBe(error);
  });

  it("lets the authentication owner absorb a catalog session failure", async () => {
    const error = new Error("Invalid session");
    const handleFailure = vi.fn(async (failure: unknown) => failure === error);

    await expect(loadAuthenticatedCatalog(
      () => "signed_in",
      async () => { throw error; },
      handleFailure
    )).resolves.toEqual([]);
    expect(handleFailure).toHaveBeenCalledWith(error);
  });

  it("rechecks auth state after failure reconciliation", async () => {
    let authStatus: DesktopAuthStatus = "signed_in";
    const error = new Error("Invalid session");

    await expect(loadAuthenticatedCatalog(
      () => authStatus,
      async () => { throw error; },
      async () => {
        authStatus = "signed_out";
        return false;
      }
    )).resolves.toEqual([]);
  });
});
