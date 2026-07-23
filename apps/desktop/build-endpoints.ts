export type DesktopBuildEnvironment = "development" | "test" | "production";

type BuildEnvironment = Record<string, string | undefined>;

const PRODUCTION_URL = "https://console.routemarket.ai";

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
    apiBaseUrl: "http://127.0.0.1:3001",
    webBaseUrl: "http://localhost:3000"
  };
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
