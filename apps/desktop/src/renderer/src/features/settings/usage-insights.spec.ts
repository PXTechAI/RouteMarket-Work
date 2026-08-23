import { describe, expect, it } from "vitest";
import type { LocalApiGatewayUsage } from "../../../../shared/desktop-api";
import { buildHeatmapMonthLabels, buildTokenActivity, buildUsageTimeSeries, buildWeeklyTokenActivity, filterDesktopUsage, groupDesktopUsage, groupDesktopUsageByModel, summarizeDesktopUsage } from "./usage-insights";

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
      p95DurationMs: 300,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreationReported: false,
      cacheHitRate: 0,
      estimatedCostUsdMicros: 0,
      estimatedCostCoveredCalls: 0
    });
  });

  it("builds time buckets and groups dimensions", () => {
    const series = buildUsageTimeSeries(records, "24h", now);
    expect(series).toHaveLength(12);
    expect(series.reduce((total, bucket) => total + bucket.calls, 0)).toBe(2);
    expect(groupDesktopUsage(records, "provider")[0]).toMatchObject({ key: "RouteMarket", calls: 2 });
  });

  it("summarizes tokens and keeps same-id models separated by provider", () => {
    const tokenRecords = records.map((record, index) => ({
      ...record,
      providerId: index === 1 ? "deepseek" : record.providerId,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 75,
      cacheCreationInputTokens: null
    }));
    expect(summarizeDesktopUsage(tokenRecords)).toMatchObject({
      totalTokens: 360,
      inputTokens: 300,
      outputTokens: 60,
      cachedInputTokens: 225,
      cacheHitRate: 0.75
    });
    expect(groupDesktopUsageByModel(tokenRecords).filter((group) => group.model === "gpt")).toHaveLength(2);
    expect(buildTokenActivity(tokenRecords, now).reduce((total, day) => total + day.tokens, 0)).toBe(360);
    expect(buildWeeklyTokenActivity(tokenRecords, now)).toHaveLength(53);
    expect(buildWeeklyTokenActivity(tokenRecords, now).reduce((total, week) => total + week.tokens, 0)).toBe(360);
    expect(summarizeDesktopUsage([{
      ...records[0]!,
      inputTokens: 160,
      outputTokens: 11_000,
      totalTokens: 1_649_160,
      cachedInputTokens: 1_583_000,
      cacheCreationInputTokens: 55_000
    }]).cacheHitRate).toBeCloseTo(1_583_000 / 1_638_160);
  });

  it("positions month labels on the 53-column activity grid", () => {
    const daily = buildTokenActivity([], now);
    const labels = buildHeatmapMonthLabels(daily, "daily");
    expect(labels).toHaveLength(12);
    expect(labels[0]).toMatchObject({ key: "2025-8", column: 3 });
    expect(labels.at(-1)).toMatchObject({ key: "2026-7", column: 51 });
    expect(buildHeatmapMonthLabels(buildWeeklyTokenActivity([], now), "weekly"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: "2026-7" })]));
  });

  it("sums only covered reference-price estimates", () => {
    expect(summarizeDesktopUsage([
      { ...records[0]!, estimatedCostUsdMicros: 125 },
      { ...records[1]!, estimatedCostUsdMicros: null },
      { ...records[2]!, estimatedCostUsdMicros: 375 }
    ])).toMatchObject({
      estimatedCostUsdMicros: 500,
      estimatedCostCoveredCalls: 2
    });
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
