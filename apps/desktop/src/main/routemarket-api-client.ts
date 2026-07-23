export type RouteMarketApiAuth = "none" | "required";

export type RouteMarketApiClientOptions = {
  baseUrl: string;
  appVersion: string;
  fetchImpl?: typeof fetch;
};

export class RouteMarketAuthenticationRequiredError extends Error {
  constructor() {
    super("Sign in to RouteMarket before using cloud features.");
    this.name = "RouteMarketAuthenticationRequiredError";
  }
}

/**
 * Single transport boundary for all first-party RouteMarket HTTP and WebSocket
 * requests made by the desktop main process. Environment selection happens
 * before construction; this client deliberately has no fallback origin.
 */
export class RouteMarketApiClient {
  private readonly baseUrl: URL;
  private accessToken: string | undefined;
  private teamId: string | undefined;

  constructor(private readonly options: RouteMarketApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
  }

  get origin(): string {
    return this.baseUrl.origin;
  }

  get isLocal(): boolean {
    return this.baseUrl.hostname === "127.0.0.1" || this.baseUrl.hostname === "localhost";
  }

  setAccessToken(token: string | undefined): void {
    this.accessToken = token;
  }

  setTeamId(teamId: string | null | undefined): void {
    this.teamId = teamId || undefined;
  }

  getWebSocketHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      ...(this.teamId ? { "X-RouteMarket-Team-Id": this.teamId } : {})
    };
  }

  resolve(path: string): string {
    return new URL(normalizePath(path), this.baseUrl).toString();
  }

  resolveWebSocket(path: string): string {
    const url = new URL(normalizePath(path), this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  request(
    path: string,
    init: RequestInit = {},
    auth: RouteMarketApiAuth = "none"
  ): Promise<Response> {
    const accessToken = auth === "required" ? this.accessToken : undefined;
    if (auth === "required" && !accessToken) {
      throw new RouteMarketAuthenticationRequiredError();
    }

    const fetchImpl = this.options.fetchImpl ?? ((input, requestInit) => fetch(input, requestInit));
    return fetchImpl(this.resolve(path), {
      ...init,
      headers: {
        Accept: "application/json",
        "X-RouteMarket-Client": "desktop",
        "X-RouteMarket-Client-Version": this.options.appVersion,
        ...toHeaderRecord(init.headers),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(accessToken && this.teamId ? { "X-RouteMarket-Team-Id": this.teamId } : {})
      }
    });
  }
}

function normalizeBaseUrl(raw: string): URL {
  const value = raw.trim();
  if (!value) throw new Error("RouteMarket API base URL is required.");

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported RouteMarket API protocol: ${url.protocol}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("RouteMarket API base URL must not contain credentials, a query, or a hash.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) throw new Error(`RouteMarket API path must start with '/': ${path}`);
  return path.slice(1);
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers || Array.isArray(headers)) {
    const result: Record<string, string> = {};
    new Headers(headers).forEach((value, name) => {
      result[name] = value;
    });
    return result;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, String(value)])
  );
}
