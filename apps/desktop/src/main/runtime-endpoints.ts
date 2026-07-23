import type { DesktopBuildEnvironment } from "../../build-endpoints";

export function resolveRuntimeEndpoint({
  defaultUrl,
  overrideUrl,
  buildEnvironment,
  name
}: {
  defaultUrl: string;
  overrideUrl?: string;
  buildEnvironment: DesktopBuildEnvironment;
  name: string;
}): string {
  const value = (overrideUrl?.trim() || defaultUrl).replace(/\/+$/, "");
  const url = new URL(value);
  if (
    buildEnvironment !== "development" &&
    (url.protocol !== "https:" || isLocalHostname(url.hostname))
  ) {
    throw new Error(
      `${name} must use a remote HTTPS URL in ${buildEnvironment} builds.`
    );
  }
  return value;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";
}
