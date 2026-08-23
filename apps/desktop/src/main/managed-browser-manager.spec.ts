import { describe, expect, it } from "vitest";
import {
  assertAgentBrowserInputAllowed,
  browserReferencedElementScript,
  isUsableBrowserNavigationUrl,
  sanitizeObservedHeaders,
  sanitizeObservedUrl
} from "./managed-browser-manager";

describe("Managed Browser observability", () => {
  it("redacts credentials and sensitive query values from observed network URLs", () => {
    const observed = new URL(sanitizeObservedUrl(
      "https://user:pass@example.com/api?token=secret&session_id=session&query=visible"
    ));

    expect(observed.username).toBe("");
    expect(observed.password).toBe("");
    expect(observed.searchParams.get("token")).toBe("[redacted]");
    expect(observed.searchParams.get("session_id")).toBe("[redacted]");
    expect(observed.searchParams.get("query")).toBe("visible");
  });

  it("bounds malformed observed URLs without throwing", () => {
    expect(sanitizeObservedUrl("not a url")).toBe("not a url");
    expect(sanitizeObservedUrl("x".repeat(10_000))).toHaveLength(8_192);
  });

  it("redacts authentication headers while preserving useful diagnostics", () => {
    expect(sanitizeObservedHeaders({
      Accept: "application/json",
      Authorization: "Bearer secret",
      Cookie: ["session=secret"],
      "X-Api-Key": "secret",
      Referer: "https://example.com/callback?code=secret&view=visible"
    })).toEqual({
      accept: "application/json",
      authorization: "[redacted]",
      cookie: "[redacted]",
      "x-api-key": "[redacted]",
      referer: "https://example.com/callback?code=%5Bredacted%5D&view=visible"
    });
  });

  it("requires user takeover before the Agent can enter a password", () => {
    try {
      assertAgentBrowserInputAllowed("password");
      throw new Error("Expected password input to be rejected.");
    } catch (error) {
      expect(error).toMatchObject({ code: "BROWSER_USER_LOGIN_REQUIRED" });
    }
    expect(() => assertAgentBrowserInputAllowed("email")).not.toThrow();
    expect(browserReferencedElementScript("#password", "type", "secret"))
      .toContain("Password entry requires user takeover");
  });

  it("accepts an HTTP document after a bounded navigation but not an empty browser page", () => {
    expect(isUsableBrowserNavigationUrl("https://www.amazon.com/errors_page/validateCaptcha"))
      .toBe(true);
    expect(isUsableBrowserNavigationUrl("http://example.com/product"))
      .toBe(true);
    expect(isUsableBrowserNavigationUrl("about:blank")).toBe(false);
    expect(isUsableBrowserNavigationUrl("")).toBe(false);
  });
});
