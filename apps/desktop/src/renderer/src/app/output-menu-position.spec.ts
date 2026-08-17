import { describe, expect, it } from "vitest";
import { calculateOutputMenuPlacement } from "./output-menu-position";

describe("calculateOutputMenuPlacement", () => {
  it("opens below a trigger near the top", () => {
    expect(calculateOutputMenuPlacement({ top: 40, right: 1000, bottom: 72 }, 1200, 800, 400))
      .toEqual({ top: 80, right: 200, maxHeight: 708, side: "bottom" });
  });

  it("flips above a trigger near the bottom", () => {
    expect(calculateOutputMenuPlacement({ top: 700, right: 1000, bottom: 732 }, 1200, 760, 400))
      .toEqual({ bottom: 68, right: 200, maxHeight: 680, side: "top" });
  });

  it("keeps the menu inside a narrow viewport", () => {
    const placement = calculateOutputMenuPlacement({ top: 40, right: 250, bottom: 72 }, 280, 500, 300);
    expect(placement.right).toBe(12);
    expect(placement.maxHeight).toBe(408);
  });
});
