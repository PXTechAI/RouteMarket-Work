import { createHash } from "node:crypto";
import type {
  ManagedBrowserProfile,
  ManagedBrowserProfileInput
} from "../shared/desktop-api";

export const DEFAULT_BROWSER_PROFILE_INPUT: ManagedBrowserProfileInput = {
  name: "Default",
  userAgent: "",
  proxyRules: "",
  proxyBypassRules: "<local>",
  persistence: "persistent"
};

export function normalizeBrowserProfileInput(
  input: ManagedBrowserProfileInput
): ManagedBrowserProfileInput {
  const name = input.name.trim().slice(0, 80);
  const userAgent = input.userAgent.trim().slice(0, 1024);
  const proxyRules = input.proxyRules.trim().slice(0, 2048);
  const proxyBypassRules = input.proxyBypassRules.trim().slice(0, 2048);
  if (!name) throw new Error("Browser Profile name is required.");
  if (/[\r\n]/.test(userAgent)) throw new Error("Browser user agent must be one line.");
  if (/[\r\n]/.test(proxyRules) || /[\r\n]/.test(proxyBypassRules)) {
    throw new Error("Browser proxy settings must be one line.");
  }
  return {
    name,
    userAgent,
    proxyRules,
    proxyBypassRules,
    persistence: input.persistence === "ephemeral" ? "ephemeral" : "persistent"
  };
}

export function browserPartition(
  profile: ManagedBrowserProfile,
  dataScopeId = "device"
): string {
  const digest = createHash("sha256")
    .update(`${dataScopeId}:${profile.localProjectId}:${profile.profileId}`)
    .digest("hex")
    .slice(0, 32);
  return `${profile.persistence === "persistent" ? "persist:" : ""}routemarket-${digest}`;
}
