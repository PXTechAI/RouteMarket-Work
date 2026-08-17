import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  desktopBuildEnvironment,
  resolveBuildAnalytics,
  resolveBuildEndpoints,
  resolveBuildMarketplacePublisherKeys,
  resolveBuildUpdateFeed
} from "./build-endpoints";

describe("desktop build endpoints", () => {
  it("uses the local development services by default for development builds", () => {
    expect(resolveBuildEndpoints("desktop-local", {})).toMatchObject({
      buildEnvironment: "development",
      apiBaseUrl: "http://127.0.0.1:3001",
      webBaseUrl: "http://localhost:3000"
    });
    expect(resolveBuildEndpoints("desktop-local", {
      ROUTEMARKET_WORK_DEV_API_URL: "http://127.0.0.1:3001/",
      ROUTEMARKET_WORK_DEV_WEB_URL: "http://localhost:3000/"
    })).toMatchObject({
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

  it("pins valid Ed25519 Marketplace public keys into release builds", () => {
    expect(resolveBuildMarketplacePublisherKeys("desktop-local", {})).toEqual({});
    expect(() => resolveBuildMarketplacePublisherKeys("desktop-release", {}))
      .toThrow("ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS_JSON");
    const { publicKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(resolveBuildMarketplacePublisherKeys("desktop-release", {
      ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS_JSON: JSON.stringify({ "pxtechai.release.2026-01": pem })
    })).toEqual({ "pxtechai.release.2026-01": pem });
    expect(() => resolveBuildMarketplacePublisherKeys("desktop-release", {
      ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS_JSON: JSON.stringify({ "pxtechai.release.2026-01": "not a key" })
    })).toThrow();
  });

  it("enables Umami only for explicitly configured release builds", () => {
    const environment = {
      ROUTEMARKET_WORK_UMAMI_HOST: "https://analytics.example.com/",
      ROUTEMARKET_WORK_UMAMI_WEBSITE_ID: "11111111-1111-4111-8111-111111111111"
    };
    expect(resolveBuildAnalytics("desktop-local", environment)).toBeNull();
    expect(resolveBuildAnalytics("production", environment)).toBeNull();
    expect(resolveBuildAnalytics("desktop-release", {})).toBeNull();
    expect(resolveBuildAnalytics("desktop-release", environment)).toEqual({
      endpoint: "https://analytics.example.com/api/send",
      websiteId: "11111111-1111-4111-8111-111111111111"
    });
  });

  it("rejects incomplete or insecure Umami release configuration", () => {
    expect(() => resolveBuildAnalytics("desktop-release", {
      ROUTEMARKET_WORK_UMAMI_HOST: "https://analytics.example.com"
    })).toThrow("must be provided together");
    expect(() => resolveBuildAnalytics("desktop-release", {
      ROUTEMARKET_WORK_UMAMI_HOST: "http://analytics.example.com",
      ROUTEMARKET_WORK_UMAMI_WEBSITE_ID: "11111111-1111-4111-8111-111111111111"
    })).toThrow("remote HTTPS");
  });
});
