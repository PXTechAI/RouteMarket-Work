import { describe, expect, it } from "vitest";
import {
  parseUpdateChannel,
  resolveDesktopUpdatePolicy,
  secureUpdateUrl
} from "./desktop-update-policy";

describe("desktop update policy", () => {
  it("disables updates for local development builds", () => {
    expect(resolveDesktopUpdatePolicy("development", {})).toMatchObject({
      enabled: false,
      channel: "stable",
      allowPrerelease: false
    });
  });

  it("supports stable and opt-in beta channels", () => {
    expect(resolveDesktopUpdatePolicy("production", {})).toMatchObject({
      enabled: true,
      channel: "stable",
      allowPrerelease: false
    });
    expect(resolveDesktopUpdatePolicy("test", {
      ROUTEMARKET_WORK_UPDATE_CHANNEL: "beta"
    })).toMatchObject({
      enabled: true,
      channel: "beta",
      allowPrerelease: true
    });
    expect(() => parseUpdateChannel("nightly")).toThrow("stable or beta");
  });

  it("uses the signed-build feed unless a secure runtime override is present", () => {
    expect(resolveDesktopUpdatePolicy(
      "production",
      {},
      "https://downloads.example.com/work"
    ).feedUrl).toBe("https://downloads.example.com/work");
    expect(resolveDesktopUpdatePolicy(
      "production",
      { ROUTEMARKET_WORK_UPDATE_URL: "https://mirror.example.com/work" },
      "https://downloads.example.com/work"
    ).feedUrl).toBe("https://mirror.example.com/work");
  });

  it("accepts only remote HTTPS update feeds", () => {
    expect(secureUpdateUrl("https://downloads.example.com/work/"))
      .toBe("https://downloads.example.com/work");
    expect(() => secureUpdateUrl("http://downloads.example.com"))
      .toThrow("remote HTTPS");
    expect(() => secureUpdateUrl("https://localhost/updates"))
      .toThrow("remote HTTPS");
  });
});
