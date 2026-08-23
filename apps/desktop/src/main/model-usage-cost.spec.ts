import { describe, expect, it } from "vitest";
import { estimateModelUsageCost } from "./model-usage-cost";

const pricing = {
  currency: "USD" as const,
  inputUsdPerMillion: 3,
  outputUsdPerMillion: 15,
  cacheReadUsdPerMillion: 0.3,
  cacheWriteUsdPerMillion: 3.75
};

describe("model usage cost", () => {
  it("does not double-charge OpenAI cached tokens that are included in input", () => {
    expect(estimateModelUsageCost({
      inputTokens: 1_000,
      outputTokens: 100,
      totalTokens: 1_100,
      cachedInputTokens: 800,
      cacheCreationInputTokens: null
    }, pricing, "openai").estimatedCostUsdMicros).toBe(2_340);
  });

  it("prices Anthropic cache reads and writes as separate input buckets", () => {
    expect(estimateModelUsageCost({
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 1_150,
      cachedInputTokens: 800,
      cacheCreationInputTokens: 50
    }, pricing, "anthropic").estimatedCostUsdMicros).toBe(2_528);
  });

  it("leaves the estimate unavailable when a used bucket has no price", () => {
    expect(estimateModelUsageCost({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 0,
      cacheCreationInputTokens: null
    }, { ...pricing, outputUsdPerMillion: null }, "openai").estimatedCostUsdMicros).toBeNull();
  });
});
