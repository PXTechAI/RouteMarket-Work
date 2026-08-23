import type { ModelTokenPricing } from "../shared/desktop-api";
import type { ModelTokenUsage } from "./model-token-usage";

export type ModelUsageAccounting = "openai" | "anthropic";

export function estimateModelUsageCost(
  usage: ModelTokenUsage,
  pricing: ModelTokenPricing | null | undefined,
  accounting: ModelUsageAccounting
): { pricingSnapshot: ModelTokenPricing | null; estimatedCostUsdMicros: number | null } {
  const snapshot = normalizeModelTokenPricing(pricing);
  if (!snapshot || !hasReportedUsage(usage)) {
    return { pricingSnapshot: snapshot, estimatedCostUsdMicros: null };
  }

  const cacheReadTokens = usage.cachedInputTokens ?? 0;
  const inputTokens = usage.inputTokens ?? 0;
  const billableInputTokens = accounting === "openai"
    ? Math.max(0, inputTokens - cacheReadTokens)
    : inputTokens;
  const buckets = [
    [billableInputTokens, snapshot.inputUsdPerMillion],
    [usage.outputTokens ?? 0, snapshot.outputUsdPerMillion],
    [cacheReadTokens, snapshot.cacheReadUsdPerMillion],
    [usage.cacheCreationInputTokens ?? 0, snapshot.cacheWriteUsdPerMillion]
  ] as const;
  if (buckets.some(([tokens, price]) => tokens > 0 && price === null)) {
    return { pricingSnapshot: snapshot, estimatedCostUsdMicros: null };
  }

  // tokens × USD-per-million equals millionths of one USD.
  const estimatedCostUsdMicros = Math.round(buckets.reduce(
    (total, [tokens, price]) => total + tokens * (price ?? 0),
    0
  ));
  return {
    pricingSnapshot: snapshot,
    estimatedCostUsdMicros: Number.isSafeInteger(estimatedCostUsdMicros) ? estimatedCostUsdMicros : null
  };
}

export function normalizeModelTokenPricing(value: unknown): ModelTokenPricing | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pricing = value as Partial<ModelTokenPricing>;
  const normalized: ModelTokenPricing = {
    currency: "USD",
    inputUsdPerMillion: normalizePrice(pricing.inputUsdPerMillion),
    outputUsdPerMillion: normalizePrice(pricing.outputUsdPerMillion),
    cacheReadUsdPerMillion: normalizePrice(pricing.cacheReadUsdPerMillion),
    cacheWriteUsdPerMillion: normalizePrice(pricing.cacheWriteUsdPerMillion)
  };
  return Object.values(normalized).some((field) => typeof field === "number")
    ? normalized
    : null;
}

function normalizePrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? Math.round(value * 1_000_000) / 1_000_000
    : null;
}

function hasReportedUsage(usage: ModelTokenUsage): boolean {
  return usage.inputTokens !== null || usage.outputTokens !== null || usage.cachedInputTokens !== null ||
    usage.cacheCreationInputTokens !== null;
}
