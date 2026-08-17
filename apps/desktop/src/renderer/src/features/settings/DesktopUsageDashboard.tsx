import { Activity, CircleCheck, Clock3, Gauge, RefreshCw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { LocalApiGatewayUsage } from "../../../../shared/desktop-api";
import { RouteMarketSelect } from "../../app/RouteMarketSelect";
import { tr } from "../../i18n";
import {
  buildUsageTimeSeries,
  filterDesktopUsage,
  groupDesktopUsage,
  summarizeDesktopUsage,
  type UsageFilters,
  type UsageRange
} from "./usage-insights";

export function DesktopUsageDashboard({
  records,
  refreshing,
  onRefresh,
  modelLabel
}: {
  records: LocalApiGatewayUsage[];
  refreshing: boolean;
  onRefresh(): void;
  modelLabel(model: string): string;
}) {
  const [filters, setFilters] = useState<UsageFilters>({
    range: "7d",
    source: "all",
    provider: "",
    model: "",
    outcome: "all"
  });
  const filtered = useMemo(() => filterDesktopUsage(records, filters), [filters, records]);
  const summary = useMemo(() => summarizeDesktopUsage(filtered), [filtered]);
  const series = useMemo(() => buildUsageTimeSeries(filtered, filters.range), [filtered, filters.range]);
  const byModel = useMemo(() => groupDesktopUsage(filtered, "model", 6), [filtered]);
  const providers = useMemo(() => [...new Set(records.map((record) => record.providerName))].sort(), [records]);
  const models = useMemo(() => [...new Set(records.map((record) => record.resolvedModel))].sort(), [records]);

  return <section className="rm-local-route-section rm-desktop-usage">
    <header>
      <div>
        <strong>{tr("settings.localApi.usageTitle")}</strong>
        <p>{tr("settings.localApi.usageDescription")}</p>
      </div>
      <button type="button" disabled={refreshing} onClick={onRefresh}>
        <RefreshCw className={refreshing ? "spin" : ""} size={14}/>{tr("settings.localApi.refreshUsage")}
      </button>
    </header>

    <div className="rm-usage-filters">
      <UsageSelect label={tr("settings.localApi.range")} value={filters.range} options={[
        { value: "24h", label: tr("settings.localApi.range24h") },
        { value: "7d", label: tr("settings.localApi.range7d") },
        { value: "30d", label: tr("settings.localApi.range30d") },
        { value: "all", label: tr("settings.localApi.rangeAll") }
      ]} onChange={(range) => setFilters((current) => ({ ...current, range: range as UsageRange }))}/>
      <UsageSelect label={tr("settings.localApi.source")} value={filters.source} options={[
        { value: "all", label: tr("settings.localApi.allSources") },
        { value: "desktop_chat", label: tr("settings.localApi.sourceChat") },
        { value: "local_gateway", label: tr("settings.localApi.sourceGateway") }
      ]} onChange={(source) => setFilters((current) => ({ ...current, source: source as UsageFilters["source"] }))}/>
      <UsageSelect label={tr("settings.localApi.provider")} value={filters.provider || "all"} options={[
        { value: "all", label: tr("settings.localApi.allProviders") },
        ...providers.map((provider) => ({ value: provider, label: provider }))
      ]} onChange={(provider) => setFilters((current) => ({ ...current, provider: provider === "all" ? "" : provider }))}/>
      <UsageSelect label={tr("settings.localApi.model")} value={filters.model || "all"} options={[
        { value: "all", label: tr("settings.localApi.allModels") },
        ...models.map((model) => ({ value: model, label: modelLabel(model) }))
      ]} onChange={(model) => setFilters((current) => ({ ...current, model: model === "all" ? "" : model }))}/>
      <UsageSelect label={tr("settings.localApi.outcome")} value={filters.outcome} options={[
        { value: "all", label: tr("settings.localApi.allOutcomes") },
        { value: "success", label: tr("settings.localApi.success") },
        { value: "error", label: tr("settings.localApi.failed") }
      ]} onChange={(outcome) => setFilters((current) => ({ ...current, outcome: outcome as UsageFilters["outcome"] }))}/>
    </div>

    <div className="rm-usage-summary">
      <SummaryCard icon={<Activity size={16}/>} label={tr("settings.localApi.totalCalls")} value={String(summary.total)}/>
      <SummaryCard icon={<CircleCheck size={16}/>} label={tr("settings.localApi.successRate")} value={`${Math.round(summary.successRate * 100)}%`} detail={tr("settings.localApi.failureCount", [summary.errors])}/>
      <SummaryCard icon={<Clock3 size={16}/>} label={tr("settings.localApi.averageLatency")} value={formatDuration(summary.averageDurationMs)}/>
      <SummaryCard icon={<Gauge size={16}/>} label={tr("settings.localApi.p95Latency")} value={formatDuration(summary.p95DurationMs)}/>
    </div>

    {filtered.length ? <>
      <div className="rm-usage-charts">
        <div className="rm-usage-chart-card">
          <div className="rm-usage-chart-heading"><span>{tr("settings.localApi.callTrend")}</span><small>{tr("settings.localApi.callsAndFailures")}</small></div>
          <UsageTrendChart series={series}/>
        </div>
        <div className="rm-usage-chart-card">
          <div className="rm-usage-chart-heading"><span>{tr("settings.localApi.modelDistribution")}</span><small>{tr("settings.localApi.callsByModel")}</small></div>
          <UsageBars values={byModel} modelLabel={modelLabel}/>
        </div>
      </div>
      <div className="rm-usage-table-wrap">
        <div className="rm-usage-chart-heading"><span>{tr("settings.localApi.recentCalls")}</span><small>{tr("settings.localApi.localDataOnly")}</small></div>
        <div className="rm-usage-table">
          <div className="head"><span>{tr("settings.localApi.time")}</span><span>{tr("settings.localApi.source")}</span><span>{tr("settings.localApi.provider")}</span><span>{tr("settings.localApi.model")}</span><span>{tr("settings.localApi.status")}</span><span>{tr("settings.localApi.latency")}</span></div>
          {filtered.slice(0, 20).map((usage) => <div key={usage.id}>
            <time>{new Date(usage.createdAt).toLocaleString()}</time>
            <span>{tr(usage.source === "desktop_chat" ? "settings.localApi.sourceChat" : "settings.localApi.sourceGateway")}</span>
            <span>{usage.providerName}</span>
            <span title={usage.resolvedModel}>{modelLabel(usage.resolvedModel)}</span>
            <span className={usage.success ? "success" : "error"}>{usage.status ?? "ERR"}</span>
            <span>{formatDuration(usage.durationMs)}</span>
          </div>)}
        </div>
      </div>
    </> : <div className="rm-usage-empty"><Activity size={23}/><span>{tr("settings.localApi.usageEmpty")}</span></div>}
  </section>;
}

function UsageSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}) {
  return <label><span>{label}</span><RouteMarketSelect label={label} value={value} options={options} onChange={onChange}/></label>;
}

function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail?: string }) {
  return <div><span className="icon">{icon}</span><div><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div></div>;
}

function UsageTrendChart({ series }: { series: Array<{ label: string; calls: number; errors: number }> }) {
  const maximum = Math.max(1, ...series.map((bucket) => bucket.calls));
  const plotHeight = 118;
  const barWidth = Math.max(8, Math.min(30, 620 / series.length - 8));
  return <div className="rm-usage-trend">
    <svg viewBox="0 0 720 168" role="img" aria-label={tr("settings.localApi.callTrend")}>
      {[0, 1, 2, 3].map((line) => <line key={line} x1="36" x2="704" y1={15 + line * 38} y2={15 + line * 38}/>) }
      {series.map((bucket, index) => {
        const slot = 668 / series.length;
        const x = 36 + index * slot + (slot - barWidth) / 2;
        const height = bucket.calls / maximum * plotHeight;
        const errorHeight = bucket.calls ? bucket.errors / bucket.calls * height : 0;
        return <g key={`${bucket.label}-${index}`}>
          <rect className="calls" x={x} y={133 - height} width={barWidth} height={height} rx="3"><title>{`${bucket.label}: ${bucket.calls}`}</title></rect>
          {errorHeight ? <rect className="errors" x={x} y={133 - errorHeight} width={barWidth} height={errorHeight} rx="3"><title>{`${bucket.label}: ${bucket.errors}`}</title></rect> : null}
          {(index === 0 || index === series.length - 1 || index % Math.ceil(series.length / 5) === 0) ? <text x={x + barWidth / 2} y="157" textAnchor="middle">{bucket.label}</text> : null}
        </g>;
      })}
    </svg>
    <div className="rm-usage-legend"><span><i className="calls"/>{tr("settings.localApi.calls")}</span><span><i className="errors"/>{tr("settings.localApi.failures")}</span></div>
  </div>;
}

function UsageBars({ values, modelLabel }: {
  values: Array<{ key: string; calls: number; errors: number; averageDurationMs: number }>;
  modelLabel(value: string): string;
}) {
  const maximum = Math.max(1, ...values.map((value) => value.calls));
  return <div className="rm-usage-bars">{values.map((value) => <div key={value.key}>
    <div><span title={value.key}>{modelLabel(value.key)}</span><small>{value.calls}</small></div>
    <div className="track"><span style={{ width: `${value.calls / maximum * 100}%` }}/></div>
    <small>{tr("settings.localApi.modelBarDetail", [value.errors, formatDuration(value.averageDurationMs)])}</small>
  </div>)}</div>;
}

function formatDuration(durationMs: number): string {
  return durationMs >= 1_000 ? `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)} s` : `${durationMs} ms`;
}
