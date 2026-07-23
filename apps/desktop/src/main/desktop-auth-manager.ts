import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  DeviceAccount,
  DeviceCredentialPayload,
  DeviceCredentials,
  DeviceSpace,
  PendingDesktopAuthorization
} from "./device-credential-store";
import type { RouteMarketApiClient } from "./routemarket-api-client";

const CALLBACK_URL = "routemarket-work://auth/callback";
const PENDING_AUTHORIZATION_TTL_MS = 15 * 60 * 1000;
const REQUIRED_SCOPES = [
  "work:runtime",
  "work:projects",
  "work:jobs",
  "work:chat"
] as const;

export type DesktopAuthStatus = "signed_out" | "authorizing" | "signed_in" | "error";

export type DesktopAuthState = {
  authStatus: DesktopAuthStatus;
  account?: DeviceAccount;
  authError: string | null;
};

type CredentialStore = {
  read(): Promise<DeviceCredentialPayload>;
  write(payload: DeviceCredentialPayload): Promise<void>;
  clear(): Promise<void>;
};

type DesktopAuthManagerOptions = {
  apiClient: RouteMarketApiClient;
  webBaseUrl?: string;
  installationId: string;
  deviceName: string;
  platform: "windows" | "macos";
  arch: "x64" | "arm64";
  appVersion: string;
  credentialStore: CredentialStore;
  openExternal(url: string): Promise<void>;
  onAccessToken(token: string | undefined): void;
  onSpaceChanged(teamId: string | null): void;
};

type ExchangeSpace = {
  id: string;
  name?: string;
  display_name?: string;
  kind?: string;
  type?: string;
  team_id?: string | null;
  avatar_url?: string | null;
  role?: string | null;
};

type ExchangeResponse = {
  access_token: string;
  expires_at: string;
  scopes: string[];
  account: {
    id: string;
    display_name: string;
    email: string | null;
    avatar_url?: string | null;
    membership?: {
      plan_code: string;
      plan_name: string;
      status: string;
      expires_at: string;
    } | null;
  };
  spaces?: ExchangeSpace[];
  workspaces?: ExchangeSpace[];
  teams?: ExchangeSpace[];
  active_space_id?: string | null;
  active_workspace_id?: string | null;
  active_team_id?: string | null;
};

type AccountSnapshotResponse = Pick<
  ExchangeResponse,
  "account" | "spaces" | "workspaces" | "teams" | "active_space_id" | "active_workspace_id" | "active_team_id"
>;

export class DesktopAuthManager {
  private state: DesktopAuthState = {
    authStatus: "signed_out",
    authError: null
  };
  private credentials: DeviceCredentials | undefined;
  private authorizationGeneration = 0;
  private credentialMutationTail: Promise<void> = Promise.resolve();
  private exchangeInFlight: {
    generation: number;
    promise: Promise<void>;
  } | null = null;
  private accountSyncInFlight: Promise<void> | null = null;

  constructor(private readonly options: DesktopAuthManagerOptions) {}

  getState(): DesktopAuthState {
    return this.state;
  }

  getAccessToken() {
    return this.credentials?.accessToken;
  }

  async initialize(): Promise<void> {
    try {
      const payload = await this.options.credentialStore.read();
      const credentials = validCredentials(payload.credentials) ? payload.credentials : undefined;
      const pending = validPendingAuthorization(payload.pendingAuthorization)
        ? payload.pendingAuthorization
        : undefined;

      if (
        credentials &&
        Date.parse(credentials.expiresAt) > Date.now() &&
        hasRequiredScopes(credentials.scopes)
      ) {
        this.credentials = credentials;
        this.state = {
          authStatus: "signed_in",
          account: credentials.account,
          authError: null
        };
        this.applyActiveSpace(credentials.account);
        this.options.onAccessToken(credentials.accessToken);
        return;
      }

      this.credentials = undefined;
      this.options.onSpaceChanged(null);
      this.options.onAccessToken(undefined);
      if (pending && !isPendingExpired(pending)) {
        this.state = {
          authStatus: "authorizing",
          authError: null
        };
        if (credentials) {
          await this.options.credentialStore.write({ pendingAuthorization: pending });
        }
        return;
      }

      if (credentials || pending) {
        await this.options.credentialStore.clear();
      }
      this.state = { authStatus: "signed_out", authError: null };
    } catch (error) {
      this.setError(error);
    }
  }

  async signIn(): Promise<void> {
    const generation = ++this.authorizationGeneration;
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const pendingAuthorization: PendingDesktopAuthorization = {
      state,
      codeVerifier,
      createdAt: new Date().toISOString()
    };

    try {
      await this.mutateCredentials(async () => {
        if (!this.isAuthorizationCurrent(generation)) return;
        await this.options.credentialStore.write({
          ...(this.credentials ? { credentials: this.credentials } : {}),
          pendingAuthorization
        });
      });
      if (!this.isAuthorizationCurrent(generation)) return;
      this.state = {
        authStatus: "authorizing",
        account: this.credentials?.account,
        authError: null
      };
      await this.options.openExternal(this.authorizationUrl(state, codeVerifier));
    } catch (error) {
      if (this.isAuthorizationCurrent(generation)) {
        this.setError(error);
      }
    }
  }

  handleCallback(rawUrl: string): Promise<void> {
    const generation = this.authorizationGeneration;
    if (this.exchangeInFlight?.generation === generation) {
      return this.exchangeInFlight.promise;
    }
    const promise = this.exchangeCallback(rawUrl, generation).finally(() => {
      if (this.exchangeInFlight?.promise === promise) {
        this.exchangeInFlight = null;
      }
    });
    this.exchangeInFlight = { generation, promise };
    return promise;
  }

  async signOut(): Promise<void> {
    const generation = ++this.authorizationGeneration;
    this.credentials = undefined;
    this.options.onSpaceChanged(null);
    this.options.onAccessToken(undefined);
    this.state = { authStatus: "signed_out", authError: null };
    try {
      await this.mutateCredentials(() => this.options.credentialStore.clear());
    } catch (error) {
      if (this.isAuthorizationCurrent(generation)) {
        this.setError(error);
      }
    }
  }

  syncAccount(): Promise<void> {
    if (!this.credentials) return Promise.resolve();
    if (this.accountSyncInFlight) return this.accountSyncInFlight;
    const promise = this.refreshAccountSnapshot().finally(() => {
      if (this.accountSyncInFlight === promise) this.accountSyncInFlight = null;
    });
    this.accountSyncInFlight = promise;
    return promise;
  }

  async switchSpace(spaceId: string): Promise<void> {
    const credentials = this.credentials;
    const space = credentials?.account.spaces?.find((candidate) => candidate.id === spaceId);
    if (!credentials || !space) throw new Error("无法切换到这个空间，请重新登录后再试。");
    if (credentials.account.activeSpaceId === spaceId) return;

    const nextCredentials: DeviceCredentials = {
      ...credentials,
      account: { ...credentials.account, activeSpaceId: spaceId }
    };
    await this.mutateCredentials(() =>
      this.options.credentialStore.write({ credentials: nextCredentials })
    );
    this.credentials = nextCredentials;
    this.state = { authStatus: "signed_in", account: nextCredentials.account, authError: null };
    this.applyActiveSpace(nextCredentials.account);
  }

  private applyActiveSpace(account: DeviceAccount): void {
    const active = account.spaces?.find((space) => space.id === account.activeSpaceId);
    this.options.onSpaceChanged(active?.teamId ?? null);
  }

  private resolveAvatarUrl(value: unknown): string | null {
    const avatarUrl = normalizeNullableString(value);
    if (!avatarUrl) return null;
    try {
      return new URL(
        avatarUrl,
        this.options.webBaseUrl ?? this.options.apiClient.origin
      ).toString();
    } catch {
      return null;
    }
  }

  private async refreshAccountSnapshot(): Promise<void> {
    const credentials = this.credentials;
    if (!credentials) return;

    try {
      const response = await this.options.apiClient.request(
        "/api/app/v1/work/account",
        { method: "GET" },
        "required"
      );
      if (response.status === 401 || response.status === 403) {
        await this.signOut();
        this.state = {
          authStatus: "signed_out",
          authError: "账户状态或登录授权已变更，请重新登录。"
        };
        return;
      }
      if (!response.ok) return;

      const result = (await response.json().catch(() => null)) as unknown;
      if (!isAccountSnapshotResponse(result) || this.credentials !== credentials) return;

      const spaces = normalizeSpaces(result, (value) => this.resolveAvatarUrl(value));
      const previousActiveSpaceId = credentials.account.activeSpaceId;
      const activeSpaceId = previousActiveSpaceId && spaces.some(({ id }) => id === previousActiveSpaceId)
        ? previousActiveSpaceId
        : resolveActiveSpaceId(result, spaces);
      const nextCredentials: DeviceCredentials = {
        ...credentials,
        account: accountFromResponse(result, spaces, activeSpaceId, (value) => this.resolveAvatarUrl(value))
      };
      await this.mutateCredentials(() => this.options.credentialStore.write({ credentials: nextCredentials }));
      if (this.credentials !== credentials) return;
      this.credentials = nextCredentials;
      this.state = { authStatus: "signed_in", account: nextCredentials.account, authError: null };
      this.applyActiveSpace(nextCredentials.account);
    } catch {
      // Keep the encrypted local session available during temporary network failures.
    }
  }

  private async exchangeCallback(rawUrl: string, generation: number): Promise<void> {
    try {
      const callback = parseCallbackUrl(rawUrl);
      const payload = await this.options.credentialStore.read();
      if (!this.isAuthorizationCurrent(generation)) return;
      const pending = payload.pendingAuthorization;
      if (
        !validPendingAuthorization(pending) ||
        isPendingExpired(pending) ||
        !secureEqual(callback.state, pending.state)
      ) {
        throw new Error("The RouteMarket sign-in request is invalid or has expired.");
      }

      const response = await this.options.apiClient.request(
        "/api/control/v1/auth/desktop/exchange",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: callback.code,
            state: callback.state,
            code_verifier: pending.codeVerifier,
            redirect_uri: CALLBACK_URL,
            installation_id: this.options.installationId
          })
        },
        "none"
      );
      if (!this.isAuthorizationCurrent(generation)) return;
      const result = (await response.json().catch(() => null)) as
        | ExchangeResponse
        | { message?: string | string[] }
        | null;
      if (!this.isAuthorizationCurrent(generation)) return;
      if (!response.ok || !isExchangeResponse(result)) {
        const message =
          result && "message" in result
            ? Array.isArray(result.message)
              ? result.message[0]
              : result.message
            : undefined;
        throw new Error(message || "RouteMarket desktop sign-in failed.");
      }
      if (!hasRequiredScopes(result.scopes)) {
        throw new Error("RouteMarket desktop authorization is missing required permissions.");
      }

      const spaces = normalizeSpaces(result, (value) => this.resolveAvatarUrl(value));
      const activeSpaceId = resolveActiveSpaceId(result, spaces);
      const credentials: DeviceCredentials = {
        accessToken: result.access_token,
        expiresAt: result.expires_at,
        scopes: result.scopes,
        account: accountFromResponse(
          result,
          spaces,
          activeSpaceId,
          (value) => this.resolveAvatarUrl(value)
        )
      };
      const committed = await this.mutateCredentials(async () => {
        if (!this.isAuthorizationCurrent(generation)) return false;
        await this.options.credentialStore.write({ credentials });
        return true;
      });
      if (!committed || !this.isAuthorizationCurrent(generation)) return;
      this.credentials = credentials;
      this.applyActiveSpace(credentials.account);
      this.options.onAccessToken(credentials.accessToken);
      this.state = {
        authStatus: "signed_in",
        account: credentials.account,
        authError: null
      };
    } catch (error) {
      if (this.isAuthorizationCurrent(generation)) {
        this.setError(error);
      }
    }
  }

  private mutateCredentials<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.credentialMutationTail.then(operation, operation);
    this.credentialMutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private isAuthorizationCurrent(generation: number): boolean {
    return generation === this.authorizationGeneration;
  }

  private authorizationUrl(state: string, codeVerifier: string) {
    const url = new URL(
      "/desktop-auth",
      this.options.webBaseUrl ?? this.options.apiClient.origin
    );
    url.searchParams.set("state", state);
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(codeVerifier).digest("base64url")
    );
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("redirect_uri", CALLBACK_URL);
    url.searchParams.set("installation_id", this.options.installationId);
    url.searchParams.set("device_name", this.options.deviceName);
    url.searchParams.set("platform", this.options.platform);
    url.searchParams.set("arch", this.options.arch);
    url.searchParams.set("app_version", this.options.appVersion);
    return url.toString();
  }

  private setError(error: unknown) {
    this.state = {
      authStatus: "error",
      account: this.credentials?.account,
      authError: error instanceof Error ? error.message : "Unknown authentication error"
    };
  }
}

function parseCallbackUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "routemarket-work:" ||
    url.hostname !== "auth" ||
    url.pathname !== "/callback"
  ) {
    throw new Error("The RouteMarket sign-in callback is invalid.");
  }
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (
    code.length < 43 ||
    code.length > 128 ||
    state.length < 32 ||
    state.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(code) ||
    !/^[A-Za-z0-9_-]+$/.test(state)
  ) {
    throw new Error("The RouteMarket sign-in callback is invalid.");
  }
  return { code, state };
}

function validCredentials(value: unknown): value is DeviceCredentials {
  if (!value || typeof value !== "object") return false;
  const credentials = value as Partial<DeviceCredentials>;
  return (
    typeof credentials.accessToken === "string" &&
    credentials.accessToken.startsWith("rmw_dt_") &&
    typeof credentials.expiresAt === "string" &&
    Array.isArray(credentials.scopes) &&
    Boolean(credentials.account) &&
    typeof credentials.account?.id === "string" &&
    typeof credentials.account?.displayName === "string"
  );
}

function validPendingAuthorization(value: unknown): value is PendingDesktopAuthorization {
  if (!value || typeof value !== "object") return false;
  const pending = value as Partial<PendingDesktopAuthorization>;
  return (
    typeof pending.state === "string" &&
    /^[A-Za-z0-9_-]{32,256}$/.test(pending.state) &&
    typeof pending.codeVerifier === "string" &&
    /^[A-Za-z0-9_-]{43,128}$/.test(pending.codeVerifier) &&
    typeof pending.createdAt === "string" &&
    Number.isFinite(Date.parse(pending.createdAt))
  );
}

function isPendingExpired(pending: PendingDesktopAuthorization) {
  return Date.now() - Date.parse(pending.createdAt) > PENDING_AUTHORIZATION_TTL_MS;
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isExchangeResponse(value: unknown): value is ExchangeResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<ExchangeResponse>;
  return (
    typeof response.access_token === "string" &&
    response.access_token.startsWith("rmw_dt_") &&
    typeof response.expires_at === "string" &&
    Array.isArray(response.scopes) &&
    Boolean(response.account) &&
    typeof response.account?.id === "string" &&
    typeof response.account?.display_name === "string" &&
    isMembershipResponse(response.account?.membership)
  );
}

function isAccountSnapshotResponse(value: unknown): value is AccountSnapshotResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<AccountSnapshotResponse>;
  return (
    Boolean(response.account) &&
    typeof response.account?.id === "string" &&
    typeof response.account?.display_name === "string" &&
    isMembershipResponse(response.account?.membership)
  );
}

function accountFromResponse(
  response: AccountSnapshotResponse,
  spaces: DeviceSpace[],
  activeSpaceId: string,
  resolveAvatarUrl: (value: unknown) => string | null
): DeviceAccount {
  return {
    id: response.account.id,
    displayName: response.account.display_name,
    email: response.account.email,
    avatarUrl: resolveAvatarUrl(response.account.avatar_url),
    spaces,
    activeSpaceId,
    ...(response.account.membership !== undefined
      ? {
          membership: response.account.membership
            ? {
                planCode: response.account.membership.plan_code,
                planName: response.account.membership.plan_name,
                status: response.account.membership.status,
                expiresAt: response.account.membership.expires_at
              }
            : null
        }
      : {})
  };
}

function normalizeSpaces(
  response: AccountSnapshotResponse,
  resolveAvatarUrl: (value: unknown) => string | null
): DeviceSpace[] {
  const personalId = `personal:${response.account.id}`;
  const personal: DeviceSpace = {
    id: personalId,
    name: "个人空间",
    kind: "personal",
    teamId: null,
    avatarUrl: resolveAvatarUrl(response.account.avatar_url),
    role: "owner"
  };
  const candidates = response.spaces ?? response.workspaces ?? response.teams ?? [];
  const spaces = candidates.flatMap((candidate): DeviceSpace[] => {
    if (!candidate || typeof candidate.id !== "string" || !candidate.id.trim()) return [];
    const rawKind = (candidate.kind ?? candidate.type ?? "team").toLowerCase();
    const kind = rawKind === "personal" ? "personal" : "team";
    const name = candidate.name ?? candidate.display_name;
    if (typeof name !== "string" || !name.trim()) return [];
    return [{
      id: candidate.id,
      name: name.trim(),
      kind,
      teamId: kind === "team" ? candidate.team_id ?? candidate.id : null,
      avatarUrl: resolveAvatarUrl(candidate.avatar_url),
      role: normalizeNullableString(candidate.role)
    }];
  });
  if (!spaces.some((space) => space.kind === "personal")) spaces.unshift(personal);
  return spaces.filter((space, index, all) => all.findIndex(({ id }) => id === space.id) === index);
}

function resolveActiveSpaceId(response: AccountSnapshotResponse, spaces: DeviceSpace[]): string {
  const explicit =
    response.active_space_id ?? response.active_workspace_id ?? response.active_team_id ?? undefined;
  if (explicit) {
    const byId = spaces.find((space) => space.id === explicit || space.teamId === explicit);
    if (byId) return byId.id;
  }
  return spaces.find((space) => space.kind === "personal")?.id ?? spaces[0]!.id;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMembershipResponse(
  membership: ExchangeResponse["account"]["membership"]
) {
  if (membership === undefined || membership === null) return true;
  return (
    typeof membership === "object" &&
    typeof membership.plan_code === "string" &&
    typeof membership.plan_name === "string" &&
    typeof membership.status === "string" &&
    typeof membership.expires_at === "string"
  );
}

function hasRequiredScopes(scopes: string[]) {
  return REQUIRED_SCOPES.every((scope) => scopes.includes(scope));
}
