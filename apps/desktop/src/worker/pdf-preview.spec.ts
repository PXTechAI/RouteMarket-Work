import { describe, expect, it } from "vitest";
import { calculatePdfRenderSize } from "./pdf-preview-limits";

describe("isolated PDF preview limits", () => {
  it("renders regular pages at a readable density", () => {
    expect(calculatePdfRenderSize(612, 792)).toEqual({ width: 918, height: 1188 });
  });

  it("bounds hostile or unusually large page dimensions", () => {
    const size = calculatePdfRenderSize(100_000, 50_000);
    expect(size.width).toBeLessThanOrEqual(2_048);
    expect(size.height).toBeLessThanOrEqual(2_048);
    expect(size.width * size.height).toBeLessThanOrEqual(4_000_000);
  });

  it("rejects invalid page dimensions", () => {
    expect(() => calculatePdfRenderSize(Number.NaN, 792)).toThrow("invalid dimensions");
    expect(() => calculatePdfRenderSize(0, 792)).toThrow("invalid dimensions");
  });
});
