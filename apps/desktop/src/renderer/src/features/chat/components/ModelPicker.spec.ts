import { describe, expect, it } from "vitest";
import type { ChatModel } from "../../../../../shared/desktop-api";
import { filterChatModels, referencePriceRows } from "./ModelPicker";

const models: ChatModel[] = [
  {
    code: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    source: "routemarket",
    providerId: null,
    providerName: "RouteMarket",
    category: "chat",
    supportsTools: true,
    supportsNativeWebSearch: false,
    supportsVision: false,
    supportsStream: true,
    supportsReasoningSummary: false,
    preferredChatProtocol: null
  },
  {
    code: "external:opencode:claude-opus",
    displayName: "Claude Opus",
    source: "external",
    providerId: "opencode",
    providerName: "OpenCode Zen",
    category: "reasoning",
    supportsTools: true,
    supportsNativeWebSearch: false,
    supportsVision: true,
    supportsStream: true,
    supportsReasoningSummary: true,
    preferredChatProtocol: "openai_responses"
  }
];

describe("filterChatModels", () => {
  it("matches model names, codes, and provider names without case sensitivity", () => {
    expect(filterChatModels(models, "flash")).toEqual([models[0]]);
    expect(filterChatModels(models, "OPENCODE")).toEqual([models[1]]);
    expect(filterChatModels(models, "external:opencode")).toEqual([models[1]]);
    expect(filterChatModels(models, "missing")).toEqual([]);
  });
});

describe("referencePriceRows", () => {
  it("keeps all pricing dimensions visible when a provider has no reference prices", () => {
    const rows = referencePriceRows(null);

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.value)).toEqual([null, null, null, null]);
  });

  it("preserves configured input, output, and cache prices independently", () => {
    const rows = referencePriceRows({
      currency: "USD",
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 5,
      cacheReadUsdPerMillion: 0.125,
      cacheWriteUsdPerMillion: null,
    });

    expect(rows.map((row) => row.value)).toEqual([1.25, 5, 0.125, null]);
  });
});
