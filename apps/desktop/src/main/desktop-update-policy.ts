import type { DesktopBuildEnvironment } from "../../build-endpoints";

export type DesktopUpdateChannel = "stable" | "beta";

export type DesktopUpdatePolicy = {
  enabled: boolean;
  channel: DesktopUpdateChannel;
  allowPrerelease: boolean;
  feedUrl: string | null;
  checkIntervalMs: number;
};

type UpdateEnvironment = Record<string, string | undefined>;

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function resolveDesktopUpdatePolicy(
  buildEnvironment: DesktopBuildEnvironment,
  environment: UpdateEnvironment = process.env,
  defaultFeedUrl: string | null = null
): DesktopUpdatePolicy {
  const channel = parseUpdateChannel(
    environment.ROUTEMARKET_WORK_UPDATE_CHANNEL
  );
  const feedUrl = environment.ROUTEMARKET_WORK_UPDATE_URL
    ? secureUpdateUrl(environment.ROUTEMARKET_WORK_UPDATE_URL)
    : defaultFeedUrl
      ? secureUpdateUrl(defaultFeedUrl)
      : null;
  return {
    enabled:
      buildEnvironment !== "development" &&
      environment.ROUTEMARKET_WORK_DISABLE_UPDATES !== "1",
    channel,
    allowPrerelease: channel === "beta",
    feedUrl,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS
  };
}

export function parseUpdateChannel(
  value: string | undefined
): DesktopUpdateChannel {
  if (!value || value === "stable") return "stable";
  if (value === "beta") return "beta";
  throw new Error(
    "ROUTEMARKET_WORK_UPDATE_CHANNEL must be stable or beta."
  );
}

export function secureUpdateUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new Error("The desktop update feed must use a remote HTTPS URL.");
  }
  return url.toString().replace(/\/+$/, "");
}
