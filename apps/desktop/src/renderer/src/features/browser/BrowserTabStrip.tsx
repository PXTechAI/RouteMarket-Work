import { LoaderCircle, Plus, X } from "lucide-react";
import type { ManagedBrowserState } from "../../../../shared/desktop-api";

type BrowserTabStripProps = {
  state: ManagedBrowserState;
  disabled: boolean;
  onCreatePage(): void;
  onSelectPage(pageId: string): void;
  onClosePage(pageId: string): void;
};

export function BrowserTabStrip({
  state,
  disabled,
  onCreatePage,
  onSelectPage,
  onClosePage
}: BrowserTabStripProps) {
  return (
    <div className="browser-tab-strip" role="tablist" aria-label="项目浏览器页面">
      <div className="browser-tabs-scroll">
        {state.pages.map((page) => (
          <button
            key={page.pageId}
            className={`browser-tab ${page.pageId === state.activePageId ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={page.pageId === state.activePageId}
            title={page.url}
            onClick={() => onSelectPage(page.pageId)}
          >
            {page.loading
              ? <LoaderCircle className="spin" size={12} />
              : <span className="browser-tab-status" data-crashed={page.crashed} />}
            <span>{page.title || page.url.replace(/^https?:\/\//, "") || "新页面"}</span>
            <span
              className="browser-tab-close"
              role="button"
              tabIndex={0}
              aria-label="关闭页面"
              onClick={(event) => {
                event.stopPropagation();
                onClosePage(page.pageId);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onClosePage(page.pageId);
                }
              }}
            >
              <X size={11} />
            </span>
          </button>
        ))}
      </div>
      <button
        className="browser-new-tab"
        type="button"
        title="在当前 Profile 中新建页面"
        disabled={disabled}
        onClick={onCreatePage}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
