import { describe, expect, it } from "vitest";
import type { LocalApiGatewayUsage } from "../../../../shared/desktop-api";
import { buildUsageTimeSeries, filterDesktopUsage, groupDesktopUsage, summarizeDesktopUsage } from "./usage-insights";

const now = Date.parse("2026-08-17T12:00:00.000Z");
const records: LocalApiGatewayUsage[] = [
  usage("a", "desktop_chat", "RouteMarket", "gpt", true, 100, "2026-08-17T11:00:00.000Z"),
  usage("b", "local_gateway", "OpenAI", "gpt", false, 300, "2026-08-17T10:00:00.000Z"),
  usage("c", "desktop_chat", "RouteMarket", "claude", true, 200, "2026-08-01T10:00:00.000Z")
];

describe("desktop usage insights", () => {
  it("filters by range, source, provider, model and outcome", () => {
    expect(filterDesktopUsage(records, {
      range: "24h",
      source: "local_gateway",
      provider: "OpenAI",
      model: "gpt",
      outcome: "error"
    }, now).map((record) => record.id)).toEqual(["b"]);
  });

  it("summarizes latency and success", () => {
    expect(summarizeDesktopUsage(records)).toEqual({
      total: 3,
      successes: 2,
      errors: 1,
      successRate: 2 / 3,
      averageDurationMs: 200,
      p95DurationMs: 300
    });
  });

  it("builds time buckets and groups dimensions", () => {
    const series = buildUsageTimeSeries(records, "24h", now);
    expect(series).toHaveLength(12);
    expect(series.reduce((total, bucket) => total + bucket.calls, 0)).toBe(2);
    expect(groupDesktopUsage(records, "provider")[0]).toMatchObject({ key: "RouteMarket", calls: 2 });
  });
});

function usage(
  id: string,
  source: LocalApiGatewayUsage["source"],
  providerName: string,
  resolvedModel: string,
  success: boolean,
  durationMs: number,
  createdAt: string
): LocalApiGatewayUsage {
  return {
    id,
    source,
    kind: "chat",
    providerId: null,
    providerName,
    requestedModel: resolvedModel,
    resolvedModel,
    routeId: null,
    status: success ? 200 : 500,
    durationMs,
    success,
    createdAt
  };
}
