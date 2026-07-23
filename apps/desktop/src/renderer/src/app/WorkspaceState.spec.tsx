import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceState } from "./WorkspaceState";

describe("WorkspaceState", () => {
  it("renders a consistent empty state with optional guidance and action", () => {
    const html = renderToStaticMarkup(
      <WorkspaceState
        kind="empty"
        icon={<span>icon</span>}
        title="选择项目"
        description="先选择一个本地项目。"
        action={<button type="button">选择</button>}
      />
    );

    expect(html).toContain("rm-workspace-state");
    expect(html).toContain("<h2>选择项目</h2>");
    expect(html).toContain("先选择一个本地项目。");
    expect(html).toContain("<button");
  });

  it("renders an accessible animated loading skeleton", () => {
    const html = renderToStaticMarkup(
      <WorkspaceState kind="loading" title="正在加载项目" compact />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="正在加载项目"');
    expect(html).toContain("rm-state-skeleton-line");
    expect(html).toContain("compact");
  });
});
