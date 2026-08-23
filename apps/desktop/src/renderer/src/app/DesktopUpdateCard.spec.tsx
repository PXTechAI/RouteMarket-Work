import { describe, expect, it } from "vitest";
import { formatUpdateBytes } from "./DesktopUpdateCard";

describe("formatUpdateBytes", () => {
  it("formats progress byte counts for the compact update card", () => {
    expect(formatUpdateBytes(0)).toBe("0 B");
    expect(formatUpdateBytes(1_024)).toBe("1.0 KB");
    expect(formatUpdateBytes(5.5 * 1_024 * 1_024)).toBe("5.5 MB");
    expect(formatUpdateBytes(Number.NaN)).toBe("0 B");
  });
});
