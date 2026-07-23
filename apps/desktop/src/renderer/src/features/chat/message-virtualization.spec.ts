import { describe, expect, it } from "vitest";
import {
  buildVirtualMessageLayout,
  visibleVirtualMessageRange
} from "./message-virtualization";

describe("message virtualization", () => {
  it("uses measured heights while estimating unseen messages", () => {
    const layout = buildVirtualMessageLayout(
      ["one", "two", "three"],
      new Map([["two", 320]]),
      100
    );

    expect(layout.heights).toEqual([100, 320, 100]);
    expect(layout.offsets).toEqual([28, 142, 476]);
    expect(layout.totalHeight).toBe(630);
  });

  it("returns only the viewport window plus overscan", () => {
    const ids = Array.from({ length: 100 }, (_, index) => `message_${index}`);
    const layout = buildVirtualMessageLayout(ids, new Map(), 100);
    const range = visibleVirtualMessageRange(layout, 4_000, 600, 200);

    expect(range.start).toBeGreaterThan(25);
    expect(range.end).toBeLessThan(55);
    expect(range.end - range.start).toBeLessThan(15);
  });

  it("keeps a renderable row for tiny and out-of-range viewports", () => {
    const layout = buildVirtualMessageLayout(["one"], new Map(), 100);
    expect(visibleVirtualMessageRange(layout, 100_000, 0, 0)).toEqual({
      start: 0,
      end: 1
    });
    expect(visibleVirtualMessageRange(
      buildVirtualMessageLayout([], new Map()),
      0,
      600
    )).toEqual({ start: 0, end: 0 });
  });
});
