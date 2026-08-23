import { describe, expect, it } from "vitest";
import type { MediaModel } from "../../../../shared/desktop-api";
import { resolveMediaGenerationProgress, resolveMediaImageSelectionPrice } from "./MediaGenerationPage";

const model: MediaModel = {
  code: "gpt-image-2",
  displayName: "GPT Image 2",
  category: "image",
  source: "routemarket",
  providerId: null,
  providerName: "RouteMarket",
  audioModes: [],
  price: 1.6,
  imageCapabilities: {
    sizes: [{ value: "1024x1024", label: "1024x1024", resolution: null, ratio: "1:1" }],
    qualities: [
      { value: "low", label: "low" },
      { value: "medium", label: "medium" },
      { value: "high", label: "high" },
    ],
    counts: [1, 2],
    defaultSize: "1024x1024",
    defaultQuality: "medium",
    defaultCount: 1,
    requestCredits: 0,
    prices: [
      { size: null, quality: "low", resolution: null, ratio: null, credits: 1.6 },
      { size: null, quality: "medium", resolution: null, ratio: null, credits: 6.3 },
      { size: null, quality: "high", resolution: null, ratio: null, credits: 25 },
    ],
  },
};

describe("resolveMediaImageSelectionPrice", () => {
  it("uses the selected Web catalog quality tier instead of the model's cheapest headline price", () => {
    expect(resolveMediaImageSelectionPrice(model, "1024x1024", "low")).toBe(1.6);
    expect(resolveMediaImageSelectionPrice(model, "1024x1024", "medium")).toBe(6.3);
    expect(resolveMediaImageSelectionPrice(model, "1024x1024", "high")).toBe(25);
    expect(resolveMediaImageSelectionPrice(model, "1024x1024", "medium", 2)).toBe(12.6);
  });

  it("rejects a quality that is not configured for the model", () => {
    expect(resolveMediaImageSelectionPrice(model, "1024x1024", "standard")).toBeNull();
  });
});

describe("resolveMediaGenerationProgress", () => {
  it("matches the Web creator progress curve and never reports completion early", () => {
    expect(resolveMediaGenerationProgress("image", 0)).toBe(6);
    expect(resolveMediaGenerationProgress("image", 18_000)).toBe(63);
    expect(resolveMediaGenerationProgress("image", 10 * 60_000)).toBe(96);
    expect(resolveMediaGenerationProgress("video", 10 * 60_000)).toBe(93);
  });
});
