import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopAuthManager } from "./desktop-auth-manager";
import type { DeviceCredentialPayload } from "./device-credential-store";

class MemoryCredentialStore {
  payload: DeviceCredentialPayload = {};

  async read(): Promise<DeviceCredentialPayload> {
    return structuredClone(this.payload);
  }

  async write(payload: DeviceCredentialPayload): Promise<void> {
    this.payload = structuredClone(payload);
  }

  async clear(): Promise<void> {
    this.payload = {};
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createManager() {
  const credentialStore = new MemoryCredentialStore();
  const openExternal = vi.fn<(url: string) => Promise<void>>(async () => undefined);
  const onAccessToken = vi.fn();
  const manager = new DesktopAuthManager({
    apiBaseUrl: "https://console.example.test",
    installationId: "install_test",
    deviceName: "Test Workstation",
    platform: "windows",
    arch: "x64",
    appVersion: "0.1.0",
    credentialStore,
    openExternal,
    onAccessToken
  });
  return { manager, credentialStore, openExternal, onAccessToken };
}

describe("DesktopAuthManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates and persists a PKCE authorization request", async () => {
    const { manager, credentialStore, openExternal } = createManager();

    await manager.signIn();

    expect(manager.getState()).toEqual({
      authStatus: "authorizing",
      account: undefined,
      authError: null
    });
    const pending = credentialStore.payload.pendingAuthorization;
    expect(pending?.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pending?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(openExternal).toHaveBeenCalledOnce();

    const authorizationUrl = new URL(openExternal.mock.calls[0]![0]);
    expect(authorizationUrl.origin).toBe("https://console.example.test");
    expect(authorizationUrl.pathname).toBe("/desktop-auth");
    expect(authorizationUrl.searchParams.get("state")).toBe(pending?.state);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "routemarket-work://auth/callback"
    );
  });

  it("rejects a callback whose state does not match", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    await manager.signIn();
    const code = "c".repeat(43);

    await manager.handleCallback(
      `routemarket-work://auth/callback?code=${code}&state=${"x".repeat(43)}`
    );

    expect(manager.getState()).toMatchObject({
      authStatus: "error",
      authError: "The RouteMarket sign-in request is invalid or has expired."
    });
    expect(credentialStore.payload.pendingAuthorization).toBeDefined();
    expect(onAccessToken).not.toHaveBeenCalled();
  });

  it("exchanges a valid callback and stores the Device Token", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    await manager.signIn();
    const pending = credentialStore.payload.pendingAuthorization!;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        access_token: `rmw_dt_${"a".repeat(43)}`,
        expires_at: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs"],
        account: {
          id: "account_test",
          display_name: "RouteMarket User",
          email: "user@example.test"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await manager.handleCallback(
      `routemarket-work://auth/callback?code=${"c".repeat(43)}&state=${pending.state}`
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.example.test/api/control/v1/auth/desktop/exchange",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(`"code_verifier":"${pending.codeVerifier}"`)
      })
    );
    expect(credentialStore.payload.pendingAuthorization).toBeUndefined();
    expect(credentialStore.payload.credentials).toMatchObject({
      accessToken: `rmw_dt_${"a".repeat(43)}`,
      account: {
        id: "account_test",
        displayName: "RouteMarket User",
        email: "user@example.test"
      }
    });
    expect(onAccessToken).toHaveBeenCalledWith(`rmw_dt_${"a".repeat(43)}`);
    expect(manager.getState()).toMatchObject({
      authStatus: "signed_in",
      account: {
        id: "account_test",
        displayName: "RouteMarket User"
      },
      authError: null
    });
  });

  it("clears credentials and disables cloud access on sign-out", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    credentialStore.payload = {
      credentials: {
        accessToken: `rmw_dt_${"a".repeat(43)}`,
        expiresAt: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime"],
        account: {
          id: "account_test",
          displayName: "RouteMarket User",
          email: null
        }
      }
    };
    await manager.initialize();
    onAccessToken.mockClear();

    await manager.signOut();

    expect(credentialStore.payload).toEqual({});
    expect(onAccessToken).toHaveBeenCalledWith(undefined);
    expect(manager.getState()).toEqual({
      authStatus: "signed_out",
      authError: null
    });
  });
});
