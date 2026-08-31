import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceCreationModeTabs } from "./WorkspaceCreationModeTabs";

describe("WorkspaceCreationModeTabs", () => {
  it("renders the web-aligned creation modes and marks the current mode", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCreationModeTabs activeMode="image" onSelect={() => undefined} />,
    );

    expect(html).toContain("对话");
    expect(html).toContain("图像创作");
    expect(html).toContain("视频创作");
    expect(html).toContain("音频生成");
    expect(html).toContain('class="active" aria-current="page"');
  });
});
