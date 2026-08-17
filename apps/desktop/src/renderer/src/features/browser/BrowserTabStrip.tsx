import { tr } from "../../i18n";
import { LoaderCircle, Plus, X } from "lucide-react";
import type { ManagedBrowserState } from "../../../../shared/desktop-api";
type BrowserTabStripProps = {
    state: ManagedBrowserState;
    disabled: boolean;
    onCreatePage(): void;
    onSelectPage(pageId: string): void;
    onClosePage(pageId: string): void;
};
export function BrowserTabStrip({ state, disabled, onCreatePage, onSelectPage, onClosePage }: BrowserTabStripProps) {
    return (<div className="browser-tab-strip" role="tablist" aria-label={tr("ui.2c45f53d603f")}>
      <div className="browser-tabs-scroll">
        {state.pages.map((page) => (<button key={page.pageId} className={`browser-tab ${page.pageId === state.activePageId ? "active" : ""}`} type="button" role="tab" aria-selected={page.pageId === state.activePageId} title={page.url} onClick={() => onSelectPage(page.pageId)}>
            {page.loading
                ? <LoaderCircle className="spin" size={12}/>
                : <span className="browser-tab-status" data-crashed={page.crashed}/>}
            <span>{page.title || page.url.replace(/^https?:\/\//, "") || tr("ui.d937c86ca860")}</span>
            <span className="browser-tab-close" role="button" tabIndex={0} aria-label={tr("ui.6b511e29b18b")} onClick={(event) => {
                event.stopPropagation();
                onClosePage(page.pageId);
            }} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClosePage(page.pageId);
                }
            }}>
              <X size={11}/>
            </span>
          </button>))}
      </div>
      <button className="browser-new-tab" type="button" title={tr("ui.fcbca84f4c3b")} disabled={disabled} onClick={onCreatePage}>
        <Plus size={15}/>
      </button>
    </div>);
}
