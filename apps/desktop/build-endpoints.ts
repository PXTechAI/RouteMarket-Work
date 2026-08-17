import { createPublicKey } from "node:crypto";

export type DesktopBuildEnvironment = "development" | "test" | "production";

export type DesktopAnalyticsBuildConfig = Readonly<{
  endpoint: string;
  websiteId: string;
}>;

type BuildEnvironment = Record<string, string | undefined>;

const PRODUCTION_URL = "https://console.routemarket.ai";
const DEVELOPMENT_API_URL = "http://127.0.0.1:3001";
const DEVELOPMENT_WEB_URL = "http://localhost:3000";

export function desktopBuildEnvironment(
  mode: string
): DesktopBuildEnvironment {
  if (mode === "production" || mode === "desktop-release") {
    return "production";
  }
  if (mode === "desktop-test") return "test";
  return "development";
}

export function resolveBuildUpdateFeed(
  mode: string,
  environment: BuildEnvironment = process.env
): string | null {
  if (mode !== "desktop-release" && mode !== "desktop-test") return null;
  return requireSecureRemoteUrl(
    environment.ROUTEMARKET_WORK_UPDATE_URL,
    "ROUTEMARKET_WORK_UPDATE_URL"
  );
}

export function resolveBuildEndpoints(
  mode: string,
  environment: BuildEnvironment = process.env
) {
  const buildEnvironment = desktopBuildEnvironment(mode);
  if (buildEnvironment === "production") {
    return {
      buildEnvironment,
      apiBaseUrl: PRODUCTION_URL,
      webBaseUrl: PRODUCTION_URL
    };
  }
  if (buildEnvironment === "test") {
    return {
      buildEnvironment,
      apiBaseUrl: requireSecureRemoteUrl(
        environment.ROUTEMARKET_WORK_TEST_API_URL,
        "ROUTEMARKET_WORK_TEST_API_URL"
      ),
      webBaseUrl: requireSecureRemoteUrl(
        environment.ROUTEMARKET_WORK_TEST_WEB_URL,
        "ROUTEMARKET_WORK_TEST_WEB_URL"
      )
    };
  }
  return {
    buildEnvironment,
    apiBaseUrl: environment.ROUTEMARKET_WORK_DEV_API_URL?.replace(/\/+$/, "") ?? DEVELOPMENT_API_URL,
    webBaseUrl: environment.ROUTEMARKET_WORK_DEV_WEB_URL?.replace(/\/+$/, "") ?? DEVELOPMENT_WEB_URL
  };
}

export function resolveBuildMarketplacePublisherKeys(
  mode: string,
  environment: BuildEnvironment = process.env
): Readonly<Record<string, string>> {
  const raw = environment.ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS_JSON;
  if (!raw) {
    if (mode === "desktop-release") {
      throw new Error("ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS_JSON is required for a desktop release build.");
    }
    return Object.freeze({});
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS_JSON must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS_JSON must be a key-to-PEM object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length || entries.length > 16) throw new Error("Marketplace publisher key set must contain between 1 and 16 keys.");
  const keys: Record<string, string> = {};
  for (const [keyId, pem] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(keyId) || typeof pem !== "string" || pem.length > 4096) {
      throw new Error("Marketplace publisher key entry is invalid.");
    }
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error(`Marketplace publisher key ${keyId} must use Ed25519.`);
    keys[keyId] = pem;
  }
  return Object.freeze(keys);
}

export function resolveBuildAnalytics(
  mode: string,
  environment: BuildEnvironment = process.env
): DesktopAnalyticsBuildConfig | null {
  if (mode !== "desktop-release") return null;

  const host = environment.ROUTEMARKET_WORK_UMAMI_HOST?.trim();
  const websiteId = environment.ROUTEMARKET_WORK_UMAMI_WEBSITE_ID?.trim();
  if (!host && !websiteId) return null;
  if (!host || !websiteId) {
    throw new Error(
      "ROUTEMARKET_WORK_UMAMI_HOST and ROUTEMARKET_WORK_UMAMI_WEBSITE_ID must be provided together."
    );
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(websiteId)) {
    throw new Error("ROUTEMARKET_WORK_UMAMI_WEBSITE_ID must be a UUID.");
  }

  return Object.freeze({
    endpoint: `${requireSecureRemoteUrl(host, "ROUTEMARKET_WORK_UMAMI_HOST")}/api/send`,
    websiteId
  });
}

function requireSecureRemoteUrl(
  value: string | undefined,
  name: string
): string {
  if (!value) throw new Error(`${name} is required for this desktop build.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || isLocalHostname(url.hostname)) {
    throw new Error(`${name} must be a remote HTTPS URL.`);
  }
  return url.toString().replace(/\/+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";
}
