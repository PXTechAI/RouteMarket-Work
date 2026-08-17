import { describe, expect, it } from "vitest";
import {
  browserPartition,
  normalizeBrowserProfileInput
} from "./managed-browser-profile";

describe("managed browser profiles", () => {
  it("normalizes profile fields", () => {
    expect(normalizeBrowserProfileInput({
      name: "  Work account  ",
      userAgent: " RouteMarketBot/1.0 ",
      proxyRules: " http=127.0.0.1:8080 ",
      proxyBypassRules: " <local> ",
      persistence: "persistent"
    })).toEqual({
      name: "Work account",
      userAgent: "RouteMarketBot/1.0",
      proxyRules: "http=127.0.0.1:8080",
      proxyBypassRules: "<local>",
      persistence: "persistent"
    });
  });

  it("creates stable isolated partitions", () => {
    const base = {
      profileId: "profile_default",
      localProjectId: "project_a",
      name: "Default",
      userAgent: "",
      proxyRules: "",
      proxyBypassRules: "<local>"
    };
    expect(browserPartition({ ...base, persistence: "persistent" })).toMatch(
      /^persist:routemarket-[a-f0-9]{32}$/
    );
    expect(browserPartition({ ...base, persistence: "ephemeral" })).toMatch(
      /^routemarket-[a-f0-9]{32}$/
    );
    expect(browserPartition({ ...base, localProjectId: "project_b", persistence: "persistent" }))
      .not.toBe(browserPartition({ ...base, persistence: "persistent" }));
    expect(browserPartition({ ...base, persistence: "persistent" }, "scope_b"))
      .not.toBe(browserPartition({ ...base, persistence: "persistent" }, "scope_a"));
  });
});
