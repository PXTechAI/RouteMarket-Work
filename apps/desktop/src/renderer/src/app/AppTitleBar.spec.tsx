import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RouteMarketWorkApi } from "../../../shared/desktop-api";
import { tr } from "../i18n";
import { AppTitleBar } from "./AppTitleBar";

describe("AppTitleBar", () => {
  it("keeps the RouteMarket Work brand and four desktop menus visible", () => {
    const html = renderToStaticMarkup(
      <AppTitleBar
        model={{ title: "RouteMarket Work", canOpenProjectFolder: false }}
        actions={{
          onNewChat: vi.fn(),
          onNewProject: vi.fn(),
          onOpenProjectFolder: vi.fn(),
          onToggleRail: vi.fn(),
          onOpenFiles: vi.fn(),
          onOpenTerminal: vi.fn(),
          onOpenBrowser: vi.fn(),
          onOpenSettings: vi.fn(),
          onCheckUpdates: vi.fn()
        }}
        api={{} as RouteMarketWorkApi}
      />
    );

    expect(html).toContain('aria-label="RouteMarket Work"');
    expect(html).toContain("rm-app-titlebar-logo");
    expect(html).toContain("RouteMarket Work");
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(4);
    expect(html).toContain(tr("menu.file"));
    expect(html).toContain(tr("menu.edit"));
    expect(html).toContain(tr("menu.view"));
    expect(html).toContain(tr("menu.help"));
  });
});
