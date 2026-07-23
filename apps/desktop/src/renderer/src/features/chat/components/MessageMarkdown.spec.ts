import { describe, expect, it } from "vitest";
import { parseMessageMarkdownBlocks } from "./MessageMarkdown";

describe("parseMessageMarkdownBlocks", () => {
  it("parses common assistant response blocks without accepting raw HTML", () => {
    expect(parseMessageMarkdownBlocks([
      "## Result",
      "",
      "- first",
      "- second",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "<script>alert('unsafe')</script>"
    ].join("\n"))).toEqual([
      { type: "heading", level: 2, text: "Result" },
      { type: "list", ordered: false, items: ["first", "second"] },
      { type: "code", language: "ts", text: "const answer = 42;" },
      { type: "paragraph", text: "<script>alert('unsafe')</script>" }
    ]);
  });
});
