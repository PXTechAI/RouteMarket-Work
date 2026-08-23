import { describe, expect, it, vi } from "vitest";
import { emptyModelTokenUsage, extractModelTokenUsage, mergeModelTokenUsage, observeResponseTokenUsage, sumModelTokenUsage } from "./model-token-usage";

describe("model token usage", () => {
  it("normalizes OpenAI, Responses, DeepSeek and Anthropic usage fields", () => {
    expect(extractModelTokenUsage({ usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      prompt_cache_hit_tokens: 90
    } })).toMatchObject({ inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedInputTokens: 90 });
    expect(extractModelTokenUsage({ response: { usage: {
      input_tokens: 80,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 60 }
    } } })).toMatchObject({ inputTokens: 80, outputTokens: 20, totalTokens: 100, cachedInputTokens: 60 });
    expect(extractModelTokenUsage({ message: { usage: {
      input_tokens: 50,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 5
    } } })).toMatchObject({ inputTokens: 50, cachedInputTokens: 40, cacheCreationInputTokens: 5 });
  });

  it("merges split Anthropic input and output usage before deriving the total", () => {
    const withInput = mergeModelTokenUsage(emptyModelTokenUsage(), extractModelTokenUsage({
      message: { usage: { input_tokens: 50, cache_read_input_tokens: 40 } }
    }));
    const complete = mergeModelTokenUsage(withInput, extractModelTokenUsage({
      usage: { output_tokens: 12 }
    }));
    expect(complete).toMatchObject({ inputTokens: 50, outputTokens: 12, totalTokens: 102, cachedInputTokens: 40, cacheCreationInputTokens: 0 });
  });

  it("observes streaming usage without changing the response body", async () => {
    const complete = vi.fn();
    const source = new Response([
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":8}}}\n\n',
      "data: [DONE]\n\n"
    ].join(""), { headers: { "content-type": "text/event-stream" } });
    const observed = observeResponseTokenUsage(source, complete);
    await expect(observed.text()).resolves.toContain("[DONE]");
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 8
    }));
  });

  it("sums usage billed across multiple model rounds", () => {
    const total = sumModelTokenUsage(
      { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40, cacheCreationInputTokens: null },
      { inputTokens: 140, outputTokens: 30, totalTokens: 170, cachedInputTokens: 80, cacheCreationInputTokens: 5 }
    );
    expect(total).toEqual({
      inputTokens: 240,
      outputTokens: 50,
      totalTokens: 290,
      cachedInputTokens: 120,
      cacheCreationInputTokens: 5
    });
  });
});
