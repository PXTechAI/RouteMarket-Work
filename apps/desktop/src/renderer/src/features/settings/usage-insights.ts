import type { LocalApiGatewayUsage } from "../../../../shared/desktop-api";

export type UsageRange = "24h" | "7d" | "30d" | "all";
export type UsageOutcome = "all" | "success" | "error";

export type UsageFilters = {
  range: UsageRange;
  source: "all" | LocalApiGatewayUsage["source"];
  provider: string;
  model: string;
  outcome: UsageOutcome;
};

export type UsageSummary = {
  total: number;
  successes: number;
  errors: number;
  successRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
};

export function filterDesktopUsage(
  records: LocalApiGatewayUsage[],
  filters: UsageFilters,
  now = Date.now()
): LocalApiGatewayUsage[] {
  const cutoff = rangeCutoff(filters.range, now);
  return records.filter((record) => {
    const createdAt = Date.parse(record.createdAt);
    return (!cutoff || createdAt >= cutoff) &&
      (filters.source === "all" || record.source === filters.source) &&
      (!filters.provider || record.providerName === filters.provider) &&
      (!filters.model || record.resolvedModel === filters.model) &&
      (filters.outcome === "all" || (filters.outcome === "success") === record.success);
  });
}

export function summarizeDesktopUsage(records: LocalApiGatewayUsage[]): UsageSummary {
  const successes = records.filter((record) => record.success).length;
  const durations = records.map((record) => record.durationMs).sort((left, right) => left - right);
  return {
    total: records.length,
    successes,
    errors: records.length - successes,
    successRate: records.length ? successes / records.length : 0,
    averageDurationMs: records.length
      ? Math.round(records.reduce((total, record) => total + record.durationMs, 0) / records.length)
      : 0,
    p95DurationMs: durations.length ? durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)]! : 0
  };
}

export function buildUsageTimeSeries(
  records: LocalApiGatewayUsage[],
  range: UsageRange,
  now = Date.now()
): Array<{ start: number; label: string; calls: number; errors: number }> {
  const { bucketMs, bucketCount } = bucketConfiguration(records, range, now);
  const end = Math.ceil(now / bucketMs) * bucketMs;
  const start = end - bucketMs * bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    start: start + index * bucketMs,
    label: formatBucketLabel(start + index * bucketMs, range),
    calls: 0,
    errors: 0
  }));
  for (const record of records) {
    const createdAt = Date.parse(record.createdAt);
    const index = Math.floor((createdAt - start) / bucketMs);
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.calls += 1;
    if (!record.success) bucket.errors += 1;
  }
  return buckets;
}

export function groupDesktopUsage(
  records: LocalApiGatewayUsage[],
  dimension: "provider" | "model" | "source" | "kind",
  limit = 8
): Array<{ key: string; calls: number; errors: number; averageDurationMs: number }> {
  const groups = new Map<string, { calls: number; errors: number; durationMs: number }>();
  for (const record of records) {
    const key = dimension === "provider" ? record.providerName :
      dimension === "model" ? record.resolvedModel :
        dimension === "source" ? record.source : record.kind;
    const current = groups.get(key) ?? { calls: 0, errors: 0, durationMs: 0 };
    current.calls += 1;
    current.errors += record.success ? 0 : 1;
    current.durationMs += record.durationMs;
    groups.set(key, current);
  }
  return [...groups.entries()]
    .map(([key, value]) => ({
      key,
      calls: value.calls,
      errors: value.errors,
      averageDurationMs: Math.round(value.durationMs / value.calls)
    }))
    .sort((left, right) => right.calls - left.calls || left.key.localeCompare(right.key))
    .slice(0, limit);
}

function rangeCutoff(range: UsageRange, now: number): number | null {
  return range === "24h" ? now - 24 * 60 * 60_000 :
    range === "7d" ? now - 7 * 24 * 60 * 60_000 :
      range === "30d" ? now - 30 * 24 * 60 * 60_000 : null;
}

function bucketConfiguration(records: LocalApiGatewayUsage[], range: UsageRange, now: number) {
  if (range === "24h") return { bucketMs: 2 * 60 * 60_000, bucketCount: 12 };
  if (range === "7d") return { bucketMs: 24 * 60 * 60_000, bucketCount: 7 };
  if (range === "30d") return { bucketMs: 3 * 24 * 60 * 60_000, bucketCount: 10 };
  const earliest = records.reduce((minimum, record) => Math.min(minimum, Date.parse(record.createdAt)), now);
  const rawBucketMs = Math.max(24 * 60 * 60_000, Math.ceil((now - earliest || 1) / 12));
  return { bucketMs: rawBucketMs, bucketCount: 12 };
}

function formatBucketLabel(timestamp: number, range: UsageRange): string {
  const date = new Date(timestamp);
  return range === "24h"
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "numeric", day: "numeric" });
}
