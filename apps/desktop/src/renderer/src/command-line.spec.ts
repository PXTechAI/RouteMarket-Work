import { describe, expect, it } from "vitest";
import { parseCommandLine } from "./command-line";

describe("command line parser", () => {
  it("separates executable and quoted arguments without invoking a shell", () => {
    expect(parseCommandLine('pnpm run dev --filter "desktop app"')).toEqual({
      executable: "pnpm",
      args: ["run", "dev", "--filter", "desktop app"]
    });
  });

  it("supports empty arguments and rejects unmatched quotes", () => {
    expect(parseCommandLine("node -e ''")).toEqual({ executable: "node", args: ["-e", ""] });
    expect(() => parseCommandLine("node 'broken")).toThrow("未闭合");
  });
});
