import type { DesktopAnalyticsBuildConfig } from "../../build-endpoints";
import type { DesktopAnalyticsEvent, DesktopLocale } from "../shared/desktop-api";

type AnalyticsFetch = (
  input: string,
  init: RequestInit
) => Promise<{ ok: boolean }>;

type DesktopAnalyticsContext = Readonly<{
  appVersion: string;
  buildEnvironment: "development" | "test" | "production";
  language: string;
  platform: NodeJS.Platform;
  arch: string;
}>;

const EVENT_NAMES = new Set<DesktopAnalyticsEvent["name"]>([
  "desktop_app_opened",
  "desktop_auth_started",
  "desktop_locale_changed",
  "desktop_project_created",
  "desktop_chat_created",
  "desktop_message_sent",
  "desktop_workflow_run_started",
  "desktop_marketplace_plugin_installed"
]);

export class DesktopAnalytics {
  constructor(
    private readonly config: DesktopAnalyticsBuildConfig | null,
    private readonly context: DesktopAnalyticsContext,
    private readonly send: AnalyticsFetch = fetch
  ) {}

  enabled(): boolean {
    return this.config !== null;
  }

  async track(input: unknown): Promise<boolean> {
    if (!this.config) return false;
    const event = parseDesktopAnalyticsEvent(input);
    if (!event) return false;

    try {
      const response = await this.send(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `RouteMarket Work/${this.context.appVersion} (${this.context.platform}; ${this.context.arch})`
        },
        body: JSON.stringify({
          type: "event",
          payload: {
            website: this.config.websiteId,
            hostname: "desktop.routemarket.ai",
            language: this.context.language,
            title: "RouteMarket Work",
            url: "/desktop",
            name: event.name,
            data: {
              appVersion: this.context.appVersion,
              buildEnvironment: this.context.buildEnvironment,
              platform: this.context.platform,
              arch: this.context.arch,
              ...(event.data ?? {})
            }
          }
        }),
        signal: AbortSignal.timeout(5_000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export function resolveRuntimeAnalyticsConfig(
  config: DesktopAnalyticsBuildConfig | null,
  environment: Record<string, string | undefined> = process.env
): DesktopAnalyticsBuildConfig | null {
  return environment.ROUTEMARKET_WORK_DISABLE_ANALYTICS === "1" ||
    environment.DO_NOT_TRACK === "1"
    ? null
    : config;
}

export function parseDesktopAnalyticsEvent(
  input: unknown
): { name: DesktopAnalyticsEvent["name"]; data?: Record<string, string | boolean> } | null {
  if (!isRecord(input) || typeof input.name !== "string" || !EVENT_NAMES.has(input.name as DesktopAnalyticsEvent["name"])) {
    return null;
  }
  const data = isRecord(input.data) ? input.data : {};
  switch (input.name) {
    case "desktop_auth_started":
      return data.intent === "login" || data.intent === "register"
        ? { name: input.name, data: { intent: data.intent } }
        : null;
    case "desktop_locale_changed":
      return isDesktopLocale(data.locale)
        ? { name: input.name, data: { locale: data.locale } }
        : null;
    case "desktop_chat_created":
      return data.scope === "project" || data.scope === "standalone"
        ? { name: input.name, data: { scope: data.scope } }
        : null;
    case "desktop_message_sent":
      return (data.scope === "project" || data.scope === "standalone") &&
        typeof data.hasAttachments === "boolean" &&
        typeof data.hasAgent === "boolean" &&
        typeof data.webSearchEnabled === "boolean"
        ? {
            name: input.name,
            data: {
              scope: data.scope,
              hasAttachments: data.hasAttachments,
              hasAgent: data.hasAgent,
              webSearchEnabled: data.webSearchEnabled
            }
          }
        : null;
    case "desktop_app_opened":
    case "desktop_project_created":
    case "desktop_workflow_run_started":
    case "desktop_marketplace_plugin_installed":
      return { name: input.name };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDesktopLocale(value: unknown): value is DesktopLocale {
  return value === "en-US" ||
    value === "zh-CN" ||
    value === "ja-JP" ||
    value === "es-ES" ||
    value === "pt-BR" ||
    value === "th-TH" ||
    value === "ko-KR";
}
