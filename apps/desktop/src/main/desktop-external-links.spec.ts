import { describe, expect, it } from "vitest";
import { routeMarketAccountUrl, type AccountLinkTarget } from "./desktop-external-links";

describe("routeMarketAccountUrl", () => {
  it.each<[AccountLinkTarget, string, string | null]>([
    ["account_center", "/workspace/chat", null],
    ["plan_upgrade", "/settings", "upgrade"],
    ["credits_top_up", "/workspace/credits", "top-up-credits"],
    ["credits_usage", "/workspace/usage", null]
  ])("builds a tracked %s URL", (target, pathname, intent) => {
    const url = new URL(routeMarketAccountUrl("https://console.routemarket.ai/", target));

    expect(url.origin).toBe("https://console.routemarket.ai");
    expect(url.pathname).toBe(pathname);
    expect(url.searchParams.get("utm_source")).toBe("routemarket_work_desktop");
    expect(url.searchParams.get("utm_medium")).toBe("desktop_app");
    expect(url.searchParams.get("utm_campaign")).toBe("account_menu");
    expect(url.searchParams.get("utm_content")).toBe(target);
    expect(url.searchParams.get("intent")).toBe(intent);
    expect(url.searchParams.get("account_settings")).toBe(
      target === "account_center" ? "profile" : null
    );
    expect(url.searchParams.has("source")).toBe(false);
  });
});
