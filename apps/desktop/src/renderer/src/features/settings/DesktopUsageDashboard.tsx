import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Database,
  Gauge,
  RefreshCw,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LocalApiGatewayUsage } from "../../../../shared/desktop-api";
import { RouteMarketSelect } from "../../app/RouteMarketSelect";
import { tr } from "../../i18n";
import "./desktop-usage.scss";
import "./desktop-usage-activity.scss";
import "./desktop-usage-charts.scss";
import "./desktop-usage-table.scss";
import {
  buildHeatmapMonthLabels,
  buildUsageTimeSeries,
  buildTokenActivity,
  buildWeeklyTokenActivity,
  filterDesktopUsage,
  groupDesktopUsageByModel,
  summarizeDesktopUsage,
  usageModelKey,
  type UsageModelGroup,
  type UsageFilters,
  type UsageRange,
} from "./usage-insights";

const USAGE_PAGE_SIZE = 20;

export function DesktopUsageDashboard({
  records,
  refreshing,
  onRefresh,
  modelLabel,
}: {
  records: LocalApiGatewayUsage[];
  refreshing: boolean;
  onRefresh(): void;
  modelLabel(model: string, providerId?: string | null, providerName?: string): string;
}) {
  const [filters, setFilters] = useState<UsageFilters>({
    range: "7d",
    source: "all",
    provider: "",
    model: "",
    outcome: "all",
  });
  const [activityGranularity, setActivityGranularity] = useState<"daily" | "weekly">("daily");
  const [usagePage, setUsagePage] = useState(1);
  const filtered = useMemo(() => filterDesktopUsage(records, filters), [filters, records]);
  const usagePageCount = Math.max(1, Math.ceil(filtered.length / USAGE_PAGE_SIZE));
  const currentUsagePage = Math.min(usagePage, usagePageCount);
  const pagedUsage = filtered.slice((currentUsagePage - 1) * USAGE_PAGE_SIZE, currentUsagePage * USAGE_PAGE_SIZE);
  const summary = useMemo(() => summarizeDesktopUsage(filtered), [filtered]);
  const series = useMemo(() => buildUsageTimeSeries(filtered, filters.range), [filtered, filters.range]);
  const byModel = useMemo(() => groupDesktopUsageByModel(filtered, 6), [filtered]);
  const dailyActivity = useMemo(() => buildTokenActivity(records), [records]);
  const weeklyActivity = useMemo(() => buildWeeklyTokenActivity(records), [records]);
  const providers = useMemo(() => [...new Set(records.map((record) => record.providerName))].sort(), [records]);
  const models = useMemo(
    () =>
      [...new Map(records.map((record) => [usageModelKey(record), record])).entries()]
        .map(([key, record]) => ({ key, record }))
        .sort(
          (left, right) =>
            left.record.providerName.localeCompare(right.record.providerName) ||
            left.record.resolvedModel.localeCompare(right.record.resolvedModel),
        ),
    [records],
  );

  useEffect(() => setUsagePage(1), [filters]);
  useEffect(() => setUsagePage((page) => Math.min(page, usagePageCount)), [usagePageCount]);

  return (
    <section className="rm-desktop-usage">
      <TokenActivityHeatmap
        values={activityGranularity === "daily" ? dailyActivity : weeklyActivity}
        granularity={activityGranularity}
        onGranularityChange={setActivityGranularity}
      />

      <header>
        <div>
          <strong>{tr("settings.localApi.usageTitle")}</strong>
          <p>{tr("settings.localApi.usageDescription")}</p>
        </div>
        <button type="button" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw className={refreshing ? "spin" : ""} size={14} />
          {tr("settings.localApi.refreshUsage")}
        </button>
      </header>

      <div className="rm-usage-filters">
        <UsageSelect
          label={tr("settings.localApi.range")}
          value={filters.range}
          options={[
            { value: "24h", label: tr("settings.localApi.range24h") },
            { value: "7d", label: tr("settings.localApi.range7d") },
            { value: "30d", label: tr("settings.localApi.range30d") },
            { value: "all", label: tr("settings.localApi.rangeAll") },
          ]}
          onChange={(range) => setFilters((current) => ({ ...current, range: range as UsageRange }))}
        />
        <UsageSelect
          label={tr("settings.localApi.source")}
          value={filters.source}
          options={[
            { value: "all", label: tr("settings.localApi.allSources") },
            { value: "desktop_chat", label: tr("settings.localApi.sourceChat") },
            { value: "desktop_media", label: tr("settings.localApi.sourceMedia") },
            { value: "local_gateway", label: tr("settings.localApi.sourceGateway") },
          ]}
          onChange={(source) => setFilters((current) => ({ ...current, source: source as UsageFilters["source"] }))}
        />
        <UsageSelect
          label={tr("settings.localApi.provider")}
          value={filters.provider || "all"}
          options={[
            { value: "all", label: tr("settings.localApi.allProviders") },
            ...providers.map((provider) => ({ value: provider, label: provider })),
          ]}
          onChange={(provider) =>
            setFilters((current) => ({ ...current, provider: provider === "all" ? "" : provider }))
          }
        />
        <UsageSelect
          label={tr("settings.localApi.model")}
          value={filters.model || "all"}
          options={[
            { value: "all", label: tr("settings.localApi.allModels") },
            ...models.map(({ key, record }) => ({
              value: key,
              label: modelLabel(record.resolvedModel, record.providerId, record.providerName),
            })),
          ]}
          onChange={(model) => setFilters((current) => ({ ...current, model: model === "all" ? "" : model }))}
        />
        <UsageSelect
          label={tr("settings.localApi.outcome")}
          value={filters.outcome}
          options={[
            { value: "all", label: tr("settings.localApi.allOutcomes") },
            { value: "success", label: tr("settings.localApi.success") },
            { value: "error", label: tr("settings.localApi.failed") },
          ]}
          onChange={(outcome) => setFilters((current) => ({ ...current, outcome: outcome as UsageFilters["outcome"] }))}
        />
      </div>

      <div className="rm-token-overview">
        <div className="rm-token-total">
          <span className="icon">
            <Zap size={19} />
          </span>
          <div>
            <span>{tr("settings.usage.totalTokens")}</span>
            <strong>{formatTokenCount(summary.totalTokens)}</strong>
            <small>{tr("settings.usage.totalTokensDetail", [formatCompactTokenCount(summary.totalTokens)])}</small>
          </div>
        </div>
        <TokenMetric label={tr("settings.usage.inputTokens")} value={summary.inputTokens} />
        <TokenMetric label={tr("settings.usage.outputTokens")} value={summary.outputTokens} />
        <TokenMetric
          label={tr("settings.usage.cachedTokens")}
          value={summary.cachedInputTokens}
          icon={<Database size={14} />}
        />
        <TokenMetric
          label={tr("settings.usage.cacheCreationTokens")}
          value={summary.cacheCreationReported ? summary.cacheCreationInputTokens : null}
        />
        <CostMetric
          costUsdMicros={summary.estimatedCostCoveredCalls ? summary.estimatedCostUsdMicros : null}
          covered={summary.estimatedCostCoveredCalls}
          total={summary.total}
        />
        <div className="rm-cache-rate">
          <div>
            <span>{tr("settings.usage.cacheHitRate")}</span>
            <strong>{formatPercent(summary.cacheHitRate)}</strong>
          </div>
          <div>
            <span style={{ width: `${summary.cacheHitRate * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="rm-usage-summary">
        <SummaryCard
          icon={<Activity size={16} />}
          label={tr("settings.localApi.totalCalls")}
          value={String(summary.total)}
        />
        <SummaryCard
          icon={<CircleCheck size={16} />}
          label={tr("settings.localApi.successRate")}
          value={`${Math.round(summary.successRate * 100)}%`}
          detail={tr("settings.localApi.failureCount", [summary.errors])}
        />
        <SummaryCard
          icon={<Clock3 size={16} />}
          label={tr("settings.localApi.averageLatency")}
          value={formatDuration(summary.averageDurationMs)}
        />
        <SummaryCard
          icon={<Gauge size={16} />}
          label={tr("settings.localApi.p95Latency")}
          value={formatDuration(summary.p95DurationMs)}
        />
      </div>

      {filtered.length ? (
        <>
          <div className="rm-usage-charts">
            <div className="rm-usage-chart-card">
              <div className="rm-usage-chart-heading">
                <span>{tr("settings.localApi.callTrend")}</span>
                <small>{tr("settings.localApi.callsAndFailures")}</small>
              </div>
              <UsageTrendChart series={series} />
            </div>
            <div className="rm-usage-chart-card">
              <div className="rm-usage-chart-heading">
                <span>{tr("settings.localApi.modelDistribution")}</span>
                <small>{tr("settings.localApi.callsByModel")}</small>
              </div>
              <UsageBars values={byModel} modelLabel={modelLabel} />
            </div>
          </div>
          <div className="rm-usage-table-wrap">
            <div className="rm-usage-chart-heading">
              <span>{tr("settings.localApi.recentCalls")}</span>
              <small>{tr("settings.localApi.localDataOnly")}</small>
            </div>
            <div className="rm-usage-table">
              <div className="head">
                <span>{tr("settings.localApi.time")}</span>
                <span>{tr("settings.localApi.source")}</span>
                <span>{tr("settings.localApi.provider")}</span>
                <span>{tr("settings.localApi.model")}</span>
                <span>{tr("settings.usage.inputShort")}</span>
                <span>{tr("settings.usage.outputShort")}</span>
                <span>{tr("settings.usage.cacheShort")}</span>
                <span>{tr("settings.localApi.status")}</span>
                <span>{tr("settings.localApi.latency")}</span>
                <span>{tr("settings.usage.costShort")}</span>
              </div>
              {pagedUsage.map((usage) => (
                <div key={usage.id}>
                  <time data-label={tr("settings.localApi.time")}>{new Date(usage.createdAt).toLocaleString()}</time>
                  <span data-label={tr("settings.localApi.source")}>
                    {tr(
                      usage.source === "desktop_chat"
                        ? "settings.localApi.sourceChat"
                        : usage.source === "desktop_media"
                          ? "settings.localApi.sourceMedia"
                          : "settings.localApi.sourceGateway",
                    )}
                  </span>
                  <span data-label={tr("settings.localApi.provider")}>{usage.providerName}</span>
                  <span data-label={tr("settings.localApi.model")} title={usage.resolvedModel}>
                    {modelLabel(usage.resolvedModel, usage.providerId, usage.providerName)}
                  </span>
                  <span data-label={tr("settings.usage.inputShort")}>{formatOptionalTokens(usage.inputTokens)}</span>
                  <span data-label={tr("settings.usage.outputShort")}>{formatOptionalTokens(usage.outputTokens)}</span>
                  <span data-label={tr("settings.usage.cacheShort")}>
                    {formatOptionalTokens(usage.cachedInputTokens)}
                  </span>
                  <span data-label={tr("settings.localApi.status")} className={usage.success ? "success" : "error"}>
                    {usage.status ?? "ERR"}
                  </span>
                  <span data-label={tr("settings.localApi.latency")}>{formatDuration(usage.durationMs)}</span>
                  <span data-label={tr("settings.usage.costShort")} title={tr("settings.usage.pricingDisclaimer")}>
                    {formatOptionalCost(usage.estimatedCostUsdMicros)}
                  </span>
                </div>
              ))}
            </div>
            <div className="rm-usage-pagination">
              <span>{tr("settings.usage.paginationSummary", [filtered.length, currentUsagePage, usagePageCount])}</span>
              <div>
                <button
                  type="button"
                  disabled={currentUsagePage === 1}
                  onClick={() => setUsagePage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft size={14} />
                  {tr("settings.usage.previousPage")}
                </button>
                <button
                  type="button"
                  disabled={currentUsagePage === usagePageCount}
                  onClick={() => setUsagePage((page) => Math.min(usagePageCount, page + 1))}
                >
                  {tr("settings.usage.nextPage")}
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="rm-usage-empty">
          <Activity size={23} />
          <span>{tr("settings.localApi.usageEmpty")}</span>
        </div>
      )}
    </section>
  );
}

function UsageSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <RouteMarketSelect label={label} value={value} options={options} onChange={onChange} />
    </label>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <span className="icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

function TokenMetric({ label, value, icon }: { label: string; value: number | null; icon?: ReactNode }) {
  return (
    <div className="rm-token-metric">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value === null ? "—" : formatCompactTokenCount(value)}</strong>
    </div>
  );
}

function CostMetric({
  costUsdMicros,
  covered,
  total,
}: {
  costUsdMicros: number | null;
  covered: number;
  total: number;
}) {
  return (
    <div className="rm-cost-metric" title={tr("settings.usage.pricingDisclaimer")}>
      <span>{tr("settings.usage.estimatedCost")}</span>
      <strong>{costUsdMicros === null ? "—" : formatUsdMicros(costUsdMicros)}</strong>
      <small>{tr("settings.usage.costCoverage", [covered, total])}</small>
    </div>
  );
}

function TokenActivityHeatmap({
  values,
  granularity,
  onGranularityChange,
}: {
  values: Array<{ date: string; tokens: number }>;
  granularity: "daily" | "weekly";
  onGranularityChange(value: "daily" | "weekly"): void;
}) {
  const maximum = Math.max(0, ...values.map((value) => value.tokens));
  const monthLabels = buildHeatmapMonthLabels(values, granularity);
  return (
    <div className="rm-token-activity">
      <div className="rm-usage-chart-heading">
        <div>
          <span>{tr("settings.usage.tokenActivity")}</span>
          <small>{tr("settings.usage.lastYear")}</small>
        </div>
        <div className="rm-token-activity-switch" role="group" aria-label={tr("settings.usage.activityGranularity")}>
          <button
            type="button"
            className={granularity === "daily" ? "active" : ""}
            aria-pressed={granularity === "daily"}
            onClick={() => onGranularityChange("daily")}
          >
            {tr("settings.usage.daily")}
          </button>
          <button
            type="button"
            className={granularity === "weekly" ? "active" : ""}
            aria-pressed={granularity === "weekly"}
            onClick={() => onGranularityChange("weekly")}
          >
            {tr("settings.usage.weekly")}
          </button>
        </div>
      </div>
      <div className={`rm-token-heatmap ${granularity}`} role="img" aria-label={tr("settings.usage.tokenActivity")}>
        {values.map((value) => {
          const intensity = maximum && value.tokens ? Math.max(1, Math.ceil((value.tokens / maximum) * 4)) : 0;
          const tooltip = tr(granularity === "daily" ? "settings.usage.dayTokens" : "settings.usage.weekTokens", [
            value.date,
            formatTokenCount(value.tokens),
          ]);
          return <i key={value.date} data-level={intensity} data-tooltip={tooltip} aria-label={tooltip} />;
        })}
      </div>
      <div className="rm-token-months" aria-hidden="true">
        {monthLabels.map((month) => (
          <span key={month.key} style={{ gridColumnStart: month.column }}>
            {month.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function UsageTrendChart({ series }: { series: Array<{ label: string; calls: number; errors: number }> }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const maximum = Math.max(1, ...series.map((bucket) => bucket.calls));
  const left = 44;
  const right = 700;
  const top = 18;
  const baseline = 138;
  const plotHeight = baseline - top;
  const xAt = (index: number) =>
    series.length > 1 ? left + (index * (right - left)) / (series.length - 1) : (left + right) / 2;
  const yAt = (value: number) => baseline - (value / maximum) * plotHeight;
  const callPoints = series.map((bucket, index) => ({ x: xAt(index), y: yAt(bucket.calls) }));
  const errorPoints = series.map((bucket, index) => ({ x: xAt(index), y: yAt(bucket.errors) }));
  const callPath = callPoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const errorPath = errorPoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const hasErrors = series.some((bucket) => bucket.errors > 0);
  const areaPath = callPoints.length
    ? `M ${callPoints[0]!.x} ${baseline} L ${callPoints.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${callPoints.at(-1)!.x} ${baseline} Z`
    : "";
  const activeBucket = hoveredIndex === null ? null : series[hoveredIndex];
  const activePoint = hoveredIndex === null ? null : callPoints[hoveredIndex];
  const tooltipX = activePoint ? Math.max(8, Math.min(532, activePoint.x - 90)) : 0;
  return (
    <div className="rm-usage-trend">
      <svg viewBox="0 0 720 180" role="img" aria-label={tr("settings.localApi.callTrend")}>
        <defs>
          <linearGradient id="rm-usage-call-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--rm-accent)" stopOpacity=".28" />
            <stop offset="1" stopColor="var(--rm-accent)" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = top + (line * plotHeight) / 3;
          const value = Math.round(maximum * (1 - line / 3));
          return (
            <g key={line}>
              <line x1={left} x2={right} y1={y} y2={y} />
              <text className="axis-value" x="35" y={y + 4} textAnchor="end">
                {value}
              </text>
            </g>
          );
        })}
        {areaPath ? <path className="calls-area" d={areaPath} /> : null}
        {callPath ? <path className="calls-line" d={callPath} /> : null}
        {hasErrors && errorPath ? <path className="errors-line" d={errorPath} /> : null}
        {series.map((bucket, index) => {
          const point = callPoints[index]!;
          const errorPoint = errorPoints[index]!;
          const hitWidth = Math.max(20, Math.min(80, (right - left) / Math.max(1, series.length - 1)));
          const active = hoveredIndex === index;
          return (
            <g
              key={`${bucket.label}-${index}`}
              className={active ? "active" : ""}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <rect className="hit-area" x={point.x - hitWidth / 2} y={top} width={hitWidth} height={baseline - top} />
              {active ? <line className="hover-guide" x1={point.x} x2={point.x} y1={top} y2={baseline} /> : null}
              <circle className="calls-point" cx={point.x} cy={point.y} r={active ? 6 : 4} />
              {bucket.errors ? (
                <circle className="errors-point" cx={errorPoint.x} cy={errorPoint.y} r={active ? 5 : 3} />
              ) : null}
              {index === 0 || index === series.length - 1 || index % Math.ceil(series.length / 5) === 0 ? (
                <text className="axis-label" x={point.x} y="164" textAnchor="middle">
                  {bucket.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {activeBucket && activePoint ? (
          <g className="rm-chart-tooltip" transform={`translate(${tooltipX} 5)`}>
            <rect width="190" height="52" rx="8" />
            <text x="12" y="20">
              {activeBucket.label}
            </text>
            <text className="detail" x="12" y="40">
              {tr("settings.localApi.calls")} {activeBucket.calls} · {tr("settings.localApi.failures")}{" "}
              {activeBucket.errors}
            </text>
          </g>
        ) : null}
      </svg>
      <div className="rm-usage-legend">
        <span>
          <i className="calls" />
          {tr("settings.localApi.calls")}
        </span>
        <span>
          <i className="errors" />
          {tr("settings.localApi.failures")}
        </span>
      </div>
    </div>
  );
}

function UsageBars({
  values,
  modelLabel,
}: {
  values: UsageModelGroup[];
  modelLabel(value: string, providerId?: string | null, providerName?: string): string;
}) {
  const maximum = Math.max(1, ...values.map((value) => value.calls));
  return (
    <div className="rm-usage-bars">
      {values.map((value) => {
        const label = modelLabel(value.model, value.providerId, value.providerName);
        const tooltip = `${label} · ${tr("settings.localApi.calls")} ${value.calls} · ${tr("settings.localApi.failures")} ${value.errors}`;
        return (
          <div key={value.key} className="rm-usage-bar-row" data-tooltip={tooltip} tabIndex={0}>
            <div>
              <span>{label}</span>
              <small>{value.calls}</small>
            </div>
            <div className="track">
              <span style={{ width: `${(value.calls / maximum) * 100}%` }} />
            </div>
            <small>
              {tr("settings.localApi.modelBarDetail", [value.errors, formatDuration(value.averageDurationMs)])}
            </small>
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(durationMs: number): string {
  return durationMs >= 1_000 ? `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)} s` : `${durationMs} ms`;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCompactTokenCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function formatOptionalTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatCompactTokenCount(value);
}

function formatOptionalCost(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatUsdMicros(value);
}

function formatUsdMicros(value: number): string {
  const dollars = value / 1_000_000;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dollars > 0 && dollars < 0.01 ? 4 : 2,
    maximumFractionDigits: dollars > 0 && dollars < 0.01 ? 6 : 2,
  }).format(dollars);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}
