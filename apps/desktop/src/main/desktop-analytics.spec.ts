import { describe, expect, it, vi } from "vitest";
import {
  DesktopAnalytics,
  parseDesktopAnalyticsEvent,
  resolveRuntimeAnalyticsConfig
} from "./desktop-analytics";

const context = {
  appVersion: "0.1.0",
  buildEnvironment: "production" as const,
  language: "zh-CN",
  platform: "win32" as const,
  arch: "x64"
};

describe("DesktopAnalytics", () => {
  it("does not send anything when the release configuration is absent", async () => {
    const send = vi.fn();
    const analytics = new DesktopAnalytics(null, context, send);
    expect(await analytics.track({ name: "desktop_project_created" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends an allowlisted Umami event without user content", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const analytics = new DesktopAnalytics({
      endpoint: "https://analytics.example.com/api/send",
      websiteId: "11111111-1111-4111-8111-111111111111"
    }, context, send);

    expect(await analytics.track({
      name: "desktop_message_sent",
      data: {
        scope: "standalone",
        hasAttachments: false,
        hasAgent: true,
        webSearchEnabled: false,
        message: "must not leave the renderer"
      }
    })).toBe(true);

    const [, init] = send.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      type: "event",
      payload: {
        website: "11111111-1111-4111-8111-111111111111",
        hostname: "desktop.routemarket.ai",
        url: "/desktop",
        name: "desktop_message_sent",
        data: {
          appVersion: "0.1.0",
          platform: "win32",
          scope: "standalone",
          hasAttachments: false,
          hasAgent: true,
          webSearchEnabled: false
        }
      }
    });
    expect(JSON.stringify(body)).not.toContain("must not leave the renderer");
  });

  it("rejects unknown event names and malformed properties", () => {
    expect(parseDesktopAnalyticsEvent({ name: "arbitrary_event" })).toBeNull();
    expect(parseDesktopAnalyticsEvent({
      name: "desktop_message_sent",
      data: { scope: "project" }
    })).toBeNull();
  });

  it("honors both RouteMarket and standard runtime opt-out flags", () => {
    const config = {
      endpoint: "https://analytics.example.com/api/send",
      websiteId: "11111111-1111-4111-8111-111111111111"
    };
    expect(resolveRuntimeAnalyticsConfig(config, {})).toBe(config);
    expect(resolveRuntimeAnalyticsConfig(config, {
      ROUTEMARKET_WORK_DISABLE_ANALYTICS: "1"
    })).toBeNull();
    expect(resolveRuntimeAnalyticsConfig(config, {
      DO_NOT_TRACK: "1"
    })).toBeNull();
  });
});
