import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopAuthManager } from "./desktop-auth-manager";
import type { DeviceCredentialPayload } from "./device-credential-store";
import { RouteMarketApiClient } from "./routemarket-api-client";

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

function createManager(webBaseUrl?: string) {
  const credentialStore = new MemoryCredentialStore();
  const openExternal = vi.fn<(url: string) => Promise<void>>(async () => undefined);
  const apiClient = new RouteMarketApiClient({
    baseUrl: "https://console.example.test",
    appVersion: "0.1.0"
  });
  const onAccessToken = vi.fn((token: string | undefined) => apiClient.setAccessToken(token));
  const onSpaceChanged = vi.fn();
  const manager = new DesktopAuthManager({
    apiClient,
    ...(webBaseUrl ? { webBaseUrl } : {}),
    installationId: "install_test",
    deviceName: "Test Workstation",
    platform: "windows",
    arch: "x64",
    appVersion: "0.1.0",
    credentialStore,
    openExternal,
    onAccessToken,
    onSpaceChanged
  });
  return { manager, credentialStore, openExternal, onAccessToken, onSpaceChanged };
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

  it("opens the web login origin while keeping API exchange separate", async () => {
    const { manager, openExternal } = createManager("http://localhost:3000");

    await manager.signIn();

    const authorizationUrl = new URL(openExternal.mock.calls[0]![0]);
    expect(authorizationUrl.origin).toBe("http://localhost:3000");
    expect(authorizationUrl.pathname).toBe("/desktop-auth");
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
    const { manager, credentialStore, onAccessToken, onSpaceChanged } = createManager();
    await manager.signIn();
    const pending = credentialStore.payload.pendingAuthorization!;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        access_token: `rmw_dt_${"a".repeat(43)}`,
        expires_at: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs", "work:chat"],
        account: {
          id: "account_test",
          display_name: "RouteMarket User",
          email: "user@example.test",
          avatar_url: "https://assets.example.test/user.png",
          membership: {
            plan_code: "pro",
            plan_name: "RouteMarket Pro",
            status: "active",
            expires_at: "2027-07-18T00:00:00.000Z"
          }
        },
        teams: [{ id: "team_design", name: "Design Team", role: "member" }],
        active_team_id: "team_design"
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
        email: "user@example.test",
        avatarUrl: "https://assets.example.test/user.png",
        activeSpaceId: "team_design",
        spaces: expect.arrayContaining([
          expect.objectContaining({ kind: "personal", teamId: null }),
          expect.objectContaining({ id: "team_design", kind: "team", teamId: "team_design" })
        ]),
        membership: {
          planCode: "pro",
          planName: "RouteMarket Pro",
          status: "active",
          expiresAt: "2027-07-18T00:00:00.000Z"
        }
      }
    });
    expect(onAccessToken).toHaveBeenCalledWith(`rmw_dt_${"a".repeat(43)}`);
    expect(onSpaceChanged).toHaveBeenCalledWith("team_design");
    expect(manager.getState()).toMatchObject({
      authStatus: "signed_in",
      account: {
        id: "account_test",
        displayName: "RouteMarket User"
      },
      authError: null
    });

    await manager.switchSpace("personal:account_test");
    expect(manager.getState().account?.activeSpaceId).toBe("personal:account_test");
    expect(credentialStore.payload.credentials?.account.activeSpaceId).toBe(
      "personal:account_test"
    );
    expect(onSpaceChanged).toHaveBeenLastCalledWith(null);
  });

  it("clears credentials and disables cloud access on sign-out", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    credentialStore.payload = {
      credentials: {
        accessToken: `rmw_dt_${"a".repeat(43)}`,
        expiresAt: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs", "work:chat"],
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

  it("refreshes account and membership details from the server", async () => {
    const { manager, credentialStore } = createManager();
    credentialStore.payload = {
      credentials: {
        accessToken: `rmw_dt_${"a".repeat(43)}`,
        expiresAt: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs", "work:chat"],
        account: {
          id: "account_test",
          displayName: "Old Name",
          email: null,
          creditsBalance: 10
        }
      }
    };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      account: {
        id: "account_test",
        display_name: "Updated User",
        email: "updated@example.test",
        credits_balance: 123.45,
        membership: {
          plan_code: "team",
          plan_name: "Team 年度版",
          status: "active",
          expires_at: "2027-12-31T00:00:00.000Z"
        }
      },
      teams: [{ id: "team_new", name: "New Team", role: "owner" }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await manager.initialize();
    await manager.syncAccount();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.example.test/api/app/v1/work/account",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer rmw_dt_${"a".repeat(43)}` })
      })
    );
    expect(manager.getState().account).toMatchObject({
      displayName: "Updated User",
      creditsBalance: 123.45,
      membership: { planCode: "team", planName: "Team 年度版" },
      spaces: expect.arrayContaining([expect.objectContaining({ id: "team_new" })])
    });
    expect(credentialStore.payload.credentials?.account.displayName).toBe("Updated User");
    expect(credentialStore.payload.credentials?.account.creditsBalance).toBe(123.45);
  });

  it("returns to signed out when the server rejects the device session", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    credentialStore.payload = {
      credentials: {
        accessToken: `rmw_dt_${"a".repeat(43)}`,
        expiresAt: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs", "work:chat"],
        account: { id: "account_test", displayName: "RouteMarket User", email: null }
      }
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => jsonResponse({ message: "Unauthorized" }, 401)));

    await manager.initialize();
    await manager.syncAccount();

    expect(credentialStore.payload).toEqual({});
    expect(onAccessToken).toHaveBeenLastCalledWith(undefined);
    expect(manager.getState()).toEqual({
      authStatus: "signed_out",
      authError: "登录已失效或已在其他设备退出，请重新登录。"
    });
  });

  it("explains when the account is restricted by the server", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    credentialStore.payload = {
      credentials: {
        accessToken: `rmw_dt_${"a".repeat(43)}`,
        expiresAt: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs", "work:chat"],
        account: { id: "account_test", displayName: "RouteMarket User", email: null }
      }
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: "Account suspended" }, 403)
    ));

    await manager.initialize();
    await manager.syncAccount();

    expect(credentialStore.payload).toEqual({});
    expect(onAccessToken).toHaveBeenLastCalledWith(undefined);
    expect(manager.getState()).toEqual({
      authStatus: "signed_out",
      authError: "当前账户暂时无法使用 RouteMarket，请前往网页端查看账户状态后重新登录。"
    });
  });

  it.each([
    {
      name: "offline",
      response: () => Promise.reject(new TypeError("fetch failed")),
      message: "当前网络不可用，已保留本地登录状态；联网后会自动恢复同步。"
    },
    {
      name: "service unavailable",
      response: () => Promise.resolve(jsonResponse({ message: "Unavailable" }, 503)),
      message: "RouteMarket 服务暂时不可用，账户信息将在服务恢复后自动同步。"
    }
  ])("keeps the local session available while $name", async ({ response, message }) => {
    const { manager, credentialStore, onAccessToken } = createManager();
    credentialStore.payload = {
      credentials: {
        accessToken: `rmw_dt_${"a".repeat(43)}`,
        expiresAt: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs", "work:chat"],
        account: { id: "account_test", displayName: "RouteMarket User", email: null }
      }
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(response));

    await manager.initialize();
    await manager.syncAccount();

    expect(credentialStore.payload.credentials).toBeDefined();
    expect(onAccessToken).toHaveBeenLastCalledWith(`rmw_dt_${"a".repeat(43)}`);
    expect(manager.getState()).toEqual({
      authStatus: "signed_in",
      account: {
        id: "account_test",
        displayName: "RouteMarket User",
        email: null
      },
      authError: message
    });
  });

  it("does not restore a session when an old callback finishes after sign-out", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    await manager.signIn();
    const pending = credentialStore.payload.pendingAuthorization!;
    let resolveExchange: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveExchange = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const callback = manager.handleCallback(
      `routemarket-work://auth/callback?code=${"c".repeat(43)}&state=${pending.state}`
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    await manager.signOut();
    resolveExchange?.(
      jsonResponse({
        access_token: `rmw_dt_${"b".repeat(43)}`,
        expires_at: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime"],
        account: {
          id: "account_stale",
          display_name: "Stale User",
          email: null
        }
      })
    );
    await callback;

    expect(credentialStore.payload).toEqual({});
    expect(onAccessToken).not.toHaveBeenCalledWith(`rmw_dt_${"b".repeat(43)}`);
    expect(onAccessToken).toHaveBeenLastCalledWith(undefined);
    expect(manager.getState()).toEqual({
      authStatus: "signed_out",
      authError: null
    });
  });

  it("clears an old Device Token that is missing required scopes", async () => {
    const { manager, credentialStore, onAccessToken } = createManager();
    credentialStore.payload = {
      credentials: {
        accessToken: `rmw_dt_${"a".repeat(43)}`,
        expiresAt: "2027-01-13T00:00:00.000Z",
        scopes: ["work:runtime", "work:projects", "work:jobs"],
        account: {
          id: "account_test",
          displayName: "RouteMarket User",
          email: null
        }
      }
    };

    await manager.initialize();

    expect(credentialStore.payload).toEqual({});
    expect(onAccessToken).toHaveBeenCalledWith(undefined);
    expect(manager.getState()).toEqual({
      authStatus: "signed_out",
      authError: null
    });
  });
});
