import { describe, expect, it, vi } from "vitest";
import {
  RouteMarketApiClient,
  RouteMarketAuthenticationRequiredError
} from "./routemarket-api-client";

describe("RouteMarketApiClient", () => {
  it("normalizes one origin for HTTP and WebSocket requests", () => {
    const client = new RouteMarketApiClient({
      baseUrl: "http://127.0.0.1:3001/",
      appVersion: "0.2.0"
    });

    expect(client.origin).toBe("http://127.0.0.1:3001");
    expect(client.isLocal).toBe(true);
    expect(client.resolve("/api/app/v1/projects")).toBe(
      "http://127.0.0.1:3001/api/app/v1/projects"
    );
    expect(client.resolveWebSocket("/api/app/v1/work/runtime-channel")).toBe(
      "ws://127.0.0.1:3001/api/app/v1/work/runtime-channel"
    );
  });

  it("adds the shared desktop identity and current access token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = new RouteMarketApiClient({
      baseUrl: "https://console.example.test",
      appVersion: "0.2.0",
      platform: "windows",
      arch: "x64",
      releaseChannel: "stable",
      buildId: "build_123",
      fetchImpl
    });
    client.setAccessToken("rmw_dt_test");
    client.setTeamId("team_design");

    await client.request(
      "/api/app/v1/projects",
      { headers: { "X-Request-ID": "request_1" } },
      "required"
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://console.example.test/api/app/v1/projects",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer rmw_dt_test",
          "X-Request-ID": "request_1",
          "X-RouteMarket-Client": "desktop",
          "X-RouteMarket-Client-Version": "0.2.0",
          "X-RouteMarket-Client-Platform": "windows",
          "X-RouteMarket-Client-Arch": "x64",
          "X-RouteMarket-Client-Release-Channel": "stable",
          "X-RouteMarket-Client-Build-Id": "build_123",
          "X-RouteMarket-Team-Id": "team_design"
        })
      })
    );
    expect(client.getWebSocketHeaders("rmw_dt_test")).toEqual({
      Authorization: "Bearer rmw_dt_test",
      "X-RouteMarket-Client": "desktop",
      "X-RouteMarket-Client-Version": "0.2.0",
      "X-RouteMarket-Client-Platform": "windows",
      "X-RouteMarket-Client-Arch": "x64",
      "X-RouteMarket-Client-Release-Channel": "stable",
      "X-RouteMarket-Client-Build-Id": "build_123",
      "X-RouteMarket-Team-Id": "team_design"
    });
  });

  it("does not fall back to an online origin when a local request fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("local API unavailable");
    });
    const client = new RouteMarketApiClient({
      baseUrl: "http://127.0.0.1:3001",
      appVersion: "0.2.0",
      fetchImpl
    });

    await expect(client.request("/health")).rejects.toThrow("local API unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://127.0.0.1:3001/health");
  });

  it("fails before I/O when authentication or endpoint configuration is invalid", () => {
    const client = new RouteMarketApiClient({
      baseUrl: "https://console.example.test",
      appVersion: "0.2.0"
    });

    expect(() => client.request("/api/app/v1/projects", {}, "required")).toThrow(
      RouteMarketAuthenticationRequiredError
    );
    expect(
      () => new RouteMarketApiClient({ baseUrl: "ftp://example.test", appVersion: "0.2.0" })
    ).toThrow("Unsupported RouteMarket API protocol");
  });
});
