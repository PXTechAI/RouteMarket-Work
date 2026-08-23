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
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheCreationReported: boolean;
  cacheHitRate: number;
  estimatedCostUsdMicros: number;
  estimatedCostCoveredCalls: number;
};

export type UsageModelGroup = {
  key: string;
  model: string;
  providerId: string | null;
  providerName: string;
  calls: number;
  errors: number;
  averageDurationMs: number;
  totalTokens: number;
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
      (!filters.model || record.resolvedModel === filters.model || usageModelKey(record) === filters.model) &&
      (filters.outcome === "all" || (filters.outcome === "success") === record.success);
  });
}

export function summarizeDesktopUsage(records: LocalApiGatewayUsage[]): UsageSummary {
  const successes = records.filter((record) => record.success).length;
  const durations = records.map((record) => record.durationMs).sort((left, right) => left - right);
  const inputTokens = sumTokens(records, "inputTokens");
  const outputTokens = sumTokens(records, "outputTokens");
  const cachedInputTokens = sumTokens(records, "cachedInputTokens");
  const cacheCreationInputTokens = sumTokens(records, "cacheCreationInputTokens");
  const cacheEligibleInputTokens = cacheDenominator(records);
  return {
    total: records.length,
    successes,
    errors: records.length - successes,
    successRate: records.length ? successes / records.length : 0,
    averageDurationMs: records.length
      ? Math.round(records.reduce((total, record) => total + record.durationMs, 0) / records.length)
      : 0,
    p95DurationMs: durations.length ? durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)]! : 0,
    inputTokens,
    outputTokens,
    totalTokens: records.reduce((total, record) => total + recordTokenTotal(record), 0),
    cachedInputTokens,
    cacheCreationInputTokens,
    cacheCreationReported: records.some((record) => record.cacheCreationInputTokens !== null && record.cacheCreationInputTokens !== undefined),
    cacheHitRate: cacheEligibleInputTokens ? Math.min(1, cachedInputTokens / cacheEligibleInputTokens) : 0,
    estimatedCostUsdMicros: records.reduce((total, record) => total + (record.estimatedCostUsdMicros ?? 0), 0),
    estimatedCostCoveredCalls: records.filter((record) => record.estimatedCostUsdMicros !== null && record.estimatedCostUsdMicros !== undefined).length
  };
}

export function groupDesktopUsageByModel(
  records: LocalApiGatewayUsage[],
  limit = 8
): UsageModelGroup[] {
  const groups = new Map<string, UsageModelGroup & { durationMs: number }>();
  for (const record of records) {
    const key = usageModelKey(record);
    const current = groups.get(key) ?? {
      key,
      model: record.resolvedModel,
      providerId: record.providerId,
      providerName: record.providerName,
      calls: 0,
      errors: 0,
      durationMs: 0,
      averageDurationMs: 0,
      totalTokens: 0
    };
    current.calls += 1;
    current.errors += record.success ? 0 : 1;
    current.durationMs += record.durationMs;
    current.totalTokens += recordTokenTotal(record);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map(({ durationMs, ...value }) => ({
      ...value,
      averageDurationMs: Math.round(durationMs / value.calls)
    }))
    .sort((left, right) => right.calls - left.calls || left.key.localeCompare(right.key))
    .slice(0, limit);
}

export function buildTokenActivity(
  records: LocalApiGatewayUsage[],
  now = Date.now(),
  dayCount = 371
): Array<{ date: string; tokens: number }> {
  const dayMs = 24 * 60 * 60_000;
  const end = startOfLocalDay(now);
  const start = end - (dayCount - 1) * dayMs;
  const values = Array.from({ length: dayCount }, (_, index) => ({
    date: localDateKey(start + index * dayMs),
    tokens: 0
  }));
  const byDate = new Map(values.map((value) => [value.date, value]));
  for (const record of records) {
    const bucket = byDate.get(localDateKey(Date.parse(record.createdAt)));
    if (bucket) bucket.tokens += recordTokenTotal(record);
  }
  return values;
}

export function buildWeeklyTokenActivity(
  records: LocalApiGatewayUsage[],
  now = Date.now(),
  weekCount = 53
): Array<{ date: string; tokens: number }> {
  const dayMs = 24 * 60 * 60_000;
  const currentDay = startOfLocalDay(now);
  const currentWeek = currentDay - ((new Date(currentDay).getDay() + 6) % 7) * dayMs;
  const start = currentWeek - (weekCount - 1) * 7 * dayMs;
  const values = Array.from({ length: weekCount }, (_, index) => ({
    date: localDateKey(start + index * 7 * dayMs),
    tokens: 0
  }));
  for (const record of records) {
    const createdAt = startOfLocalDay(Date.parse(record.createdAt));
    const index = Math.floor((createdAt - start) / (7 * dayMs));
    const bucket = values[index];
    if (bucket) bucket.tokens += recordTokenTotal(record);
  }
  return values;
}

export function buildHeatmapMonthLabels(
  values: Array<{ date: string }>,
  granularity: "daily" | "weekly"
): Array<{ key: string; label: string; column: number }> {
  const labels: Array<{ key: string; label: string; column: number }> = [];
  let previousMonth = "";
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const date = new Date(`${value.date}T00:00:00`);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (key === previousMonth) continue;
    previousMonth = key;
    // A partial month at the far-left edge is too narrow to label clearly.
    if (index === 0 && date.getDate() > 7) continue;
    labels.push({
      key,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
      column: granularity === "daily" ? Math.floor(index / 7) + 1 : index + 1
    });
  }
  return labels;
}

export function usageModelKey(record: Pick<LocalApiGatewayUsage, "providerId" | "providerName" | "resolvedModel">): string {
  return `${record.providerId ?? record.providerName}\u0000${record.resolvedModel}`;
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

function sumTokens(records: LocalApiGatewayUsage[], field: "inputTokens" | "outputTokens" | "cachedInputTokens" | "cacheCreationInputTokens"): number {
  return records.reduce((total, record) => total + (record[field] ?? 0), 0);
}

function recordTokenTotal(record: LocalApiGatewayUsage): number {
  if (record.totalTokens !== null && record.totalTokens !== undefined) return record.totalTokens;
  return (record.inputTokens ?? 0) + (record.outputTokens ?? 0) +
    (record.cacheCreationInputTokens !== null && record.cacheCreationInputTokens !== undefined
      ? (record.cachedInputTokens ?? 0) + record.cacheCreationInputTokens
      : 0);
}

function cacheDenominator(records: LocalApiGatewayUsage[]): number {
  return records.reduce((total, record) => total + (record.inputTokens ?? 0) +
    (record.cacheCreationInputTokens !== null && record.cacheCreationInputTokens !== undefined
      ? (record.cachedInputTokens ?? 0) + record.cacheCreationInputTokens
      : 0), 0);
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
