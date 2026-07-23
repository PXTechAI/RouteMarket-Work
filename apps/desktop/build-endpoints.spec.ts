import { describe, expect, it } from "vitest";
import {
  desktopBuildEnvironment,
  resolveBuildEndpoints,
  resolveBuildUpdateFeed
} from "./build-endpoints";

describe("desktop build endpoints", () => {
  it("uses local endpoints only for development builds", () => {
    expect(resolveBuildEndpoints("desktop-local", {})).toMatchObject({
      buildEnvironment: "development",
      apiBaseUrl: "http://127.0.0.1:3001",
      webBaseUrl: "http://localhost:3000"
    });
  });

  it("locks production builds to the production HTTPS origin", () => {
    expect(resolveBuildEndpoints("production", {
      ROUTEMARKET_WORK_TEST_API_URL: "http://127.0.0.1:3001"
    })).toEqual({
      buildEnvironment: "production",
      apiBaseUrl: "https://console.routemarket.ai",
      webBaseUrl: "https://console.routemarket.ai"
    });
    expect(desktopBuildEnvironment("production")).toBe("production");
    expect(desktopBuildEnvironment("desktop-release")).toBe("production");
  });

  it("requires explicit remote HTTPS endpoints for test builds", () => {
    expect(() => resolveBuildEndpoints("desktop-test", {})).toThrow(
      "ROUTEMARKET_WORK_TEST_API_URL"
    );
    expect(() => resolveBuildEndpoints("desktop-test", {
      ROUTEMARKET_WORK_TEST_API_URL: "http://localhost:3001",
      ROUTEMARKET_WORK_TEST_WEB_URL: "https://test.example.com"
    })).toThrow("remote HTTPS");
    expect(resolveBuildEndpoints("desktop-test", {
      ROUTEMARKET_WORK_TEST_API_URL: "https://api.test.example.com/",
      ROUTEMARKET_WORK_TEST_WEB_URL: "https://work.test.example.com/"
    })).toEqual({
      buildEnvironment: "test",
      apiBaseUrl: "https://api.test.example.com",
      webBaseUrl: "https://work.test.example.com"
    });
  });

  it("requires a secure update feed only for distributable builds", () => {
    expect(resolveBuildUpdateFeed("production", {})).toBeNull();
    expect(() => resolveBuildUpdateFeed("desktop-release", {}))
      .toThrow("ROUTEMARKET_WORK_UPDATE_URL");
    expect(resolveBuildUpdateFeed("desktop-release", {
      ROUTEMARKET_WORK_UPDATE_URL: "https://downloads.example.com/work/"
    })).toBe("https://downloads.example.com/work");
  });
});
