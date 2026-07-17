import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  DeviceAccount,
  DeviceCredentialPayload,
  DeviceCredentials,
  PendingDesktopAuthorization
} from "./device-credential-store";

const CALLBACK_URL = "routemarket-work://auth/callback";
const PENDING_AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

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
  apiBaseUrl: string;
  installationId: string;
  deviceName: string;
  platform: "windows" | "macos";
  arch: "x64" | "arm64";
  appVersion: string;
  credentialStore: CredentialStore;
  openExternal(url: string): Promise<void>;
  onAccessToken(token: string | undefined): void;
};

type ExchangeResponse = {
  access_token: string;
  expires_at: string;
  scopes: string[];
  account: {
    id: string;
    display_name: string;
    email: string | null;
  };
};

export class DesktopAuthManager {
  private state: DesktopAuthState = {
    authStatus: "signed_out",
    authError: null
  };
  private credentials: DeviceCredentials | undefined;
  private exchangeInFlight: Promise<void> | null = null;

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

      if (credentials && Date.parse(credentials.expiresAt) > Date.now()) {
        this.credentials = credentials;
        this.state = {
          authStatus: "signed_in",
          account: credentials.account,
          authError: null
        };
        this.options.onAccessToken(credentials.accessToken);
        return;
      }

      this.credentials = undefined;
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
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const pendingAuthorization: PendingDesktopAuthorization = {
      state,
      codeVerifier,
      createdAt: new Date().toISOString()
    };

    try {
      await this.options.credentialStore.write({
        ...(this.credentials ? { credentials: this.credentials } : {}),
        pendingAuthorization
      });
      this.state = {
        authStatus: "authorizing",
        account: this.credentials?.account,
        authError: null
      };
      await this.options.openExternal(this.authorizationUrl(state, codeVerifier));
    } catch (error) {
      this.setError(error);
    }
  }

  handleCallback(rawUrl: string): Promise<void> {
    if (this.exchangeInFlight) return this.exchangeInFlight;
    this.exchangeInFlight = this.exchangeCallback(rawUrl).finally(() => {
      this.exchangeInFlight = null;
    });
    return this.exchangeInFlight;
  }

  async signOut(): Promise<void> {
    try {
      await this.options.credentialStore.clear();
      this.credentials = undefined;
      this.options.onAccessToken(undefined);
      this.state = { authStatus: "signed_out", authError: null };
    } catch (error) {
      this.setError(error);
    }
  }

  private async exchangeCallback(rawUrl: string): Promise<void> {
    try {
      const callback = parseCallbackUrl(rawUrl);
      const payload = await this.options.credentialStore.read();
      const pending = payload.pendingAuthorization;
      if (
        !validPendingAuthorization(pending) ||
        isPendingExpired(pending) ||
        !secureEqual(callback.state, pending.state)
      ) {
        throw new Error("The RouteMarket sign-in request is invalid or has expired.");
      }

      const response = await fetch(
        `${this.options.apiBaseUrl}/api/control/v1/auth/desktop/exchange`,
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
        }
      );
      const result = (await response.json().catch(() => null)) as
        | ExchangeResponse
        | { message?: string | string[] }
        | null;
      if (!response.ok || !isExchangeResponse(result)) {
        const message =
          result && "message" in result
            ? Array.isArray(result.message)
              ? result.message[0]
              : result.message
            : undefined;
        throw new Error(message || "RouteMarket desktop sign-in failed.");
      }

      const credentials: DeviceCredentials = {
        accessToken: result.access_token,
        expiresAt: result.expires_at,
        scopes: result.scopes,
        account: {
          id: result.account.id,
          displayName: result.account.display_name,
          email: result.account.email
        }
      };
      await this.options.credentialStore.write({ credentials });
      this.credentials = credentials;
      this.options.onAccessToken(credentials.accessToken);
      this.state = {
        authStatus: "signed_in",
        account: credentials.account,
        authError: null
      };
    } catch (error) {
      this.setError(error);
    }
  }

  private authorizationUrl(state: string, codeVerifier: string) {
    const url = new URL("/desktop-auth", this.options.apiBaseUrl);
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
    typeof response.account?.display_name === "string"
  );
}
