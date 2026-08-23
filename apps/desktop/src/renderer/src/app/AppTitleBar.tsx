import { useEffect, useRef, useState, type ReactNode } from "react";
import brandIcon from "../assets/routemarket-2a-naked";
import type { DesktopMenuCommand, RouteMarketWorkApi } from "../../../shared/desktop-api";
import { tr } from "../i18n";
import "./app-titlebar.scss";

type MenuName = "file" | "edit" | "view" | "help";

type AppTitleBarProps = {
  model: {
    title: string;
    canOpenProjectFolder: boolean;
  };
  actions: {
    onNewChat(): void;
    onNewProject(): void;
    onOpenProjectFolder(): void;
    onToggleRail(): void;
    onOpenFiles(): void;
    onOpenTerminal(): void;
    onOpenBrowser(): void;
    onOpenSettings(): void;
    onCheckUpdates(): void;
  };
  api: RouteMarketWorkApi;
};

export function AppTitleBar({ model, actions, api }: AppTitleBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        actions.onNewChat();
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        actions.onToggleRail();
      } else if (event.key === "`") {
        event.preventDefault();
        actions.onOpenTerminal();
      } else if (event.key === ",") {
        event.preventDefault();
        actions.onOpenSettings();
      }
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", keydown);
    };
  }, [actions]);

  useEffect(() => {
    const sync = () => {
      const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      void api.setTitleBarTheme(theme);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [api]);

  const command = (value: DesktopMenuCommand) => {
    setOpenMenu(null);
    void api.executeMenuCommand(value);
  };
  const run = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <header className="rm-app-titlebar" ref={rootRef}>
      <div className="rm-app-titlebar-brand" aria-label="RouteMarket Work">
        <img className="rm-app-titlebar-logo" src={brandIcon} alt="" />
        <span>RouteMarket Work</span>
      </div>
      <TitleMenu label={tr("menu.file")} name="file" openMenu={openMenu} onToggle={setOpenMenu}>
        <MenuItem label={tr("menu.file.newChat")} shortcut="Ctrl+N" onClick={() => run(actions.onNewChat)} />
        <MenuItem label={tr("menu.file.newProject")} onClick={() => run(actions.onNewProject)} />
        <MenuItem label={tr("menu.file.openProjectFolder")} shortcut="Ctrl+O" disabled={!model.canOpenProjectFolder} onClick={() => run(actions.onOpenProjectFolder)} />
        <MenuSeparator />
        <MenuItem label={tr("menu.file.close")} shortcut="Ctrl+W" onClick={() => command("closeWindow")} />
        <MenuItem label={tr("menu.file.quit")} shortcut="Ctrl+Q" onClick={() => command("quit")} />
      </TitleMenu>
      <TitleMenu label={tr("menu.edit")} name="edit" openMenu={openMenu} onToggle={setOpenMenu}>
        <MenuItem label={tr("menu.edit.undo")} shortcut="Ctrl+Z" onClick={() => command("undo")} />
        <MenuItem label={tr("menu.edit.redo")} shortcut="Ctrl+Y" onClick={() => command("redo")} />
        <MenuSeparator />
        <MenuItem label={tr("menu.edit.cut")} shortcut="Ctrl+X" onClick={() => command("cut")} />
        <MenuItem label={tr("menu.edit.copy")} shortcut="Ctrl+C" onClick={() => command("copy")} />
        <MenuItem label={tr("menu.edit.paste")} shortcut="Ctrl+V" onClick={() => command("paste")} />
        <MenuItem label={tr("menu.edit.delete")} onClick={() => command("delete")} />
        <MenuSeparator />
        <MenuItem label={tr("menu.edit.selectAll")} shortcut="Ctrl+A" onClick={() => command("selectAll")} />
        <MenuSeparator />
        <MenuItem label={tr("menu.edit.settings")} shortcut="Ctrl+," onClick={() => run(actions.onOpenSettings)} />
      </TitleMenu>
      <TitleMenu label={tr("menu.view")} name="view" openMenu={openMenu} onToggle={setOpenMenu}>
        <MenuItem label={tr("menu.view.toggleRail")} shortcut="Ctrl+B" onClick={() => run(actions.onToggleRail)} />
        <MenuItem label={tr("menu.view.files")} onClick={() => run(actions.onOpenFiles)} />
        <MenuItem label={tr("menu.view.terminal")} shortcut="Ctrl+`" onClick={() => run(actions.onOpenTerminal)} />
        <MenuItem label={tr("menu.view.browser")} onClick={() => run(actions.onOpenBrowser)} />
        <MenuSeparator />
        <MenuItem label={tr("menu.view.zoomIn")} shortcut="Ctrl++" onClick={() => command("zoomIn")} />
        <MenuItem label={tr("menu.view.zoomOut")} shortcut="Ctrl+-" onClick={() => command("zoomOut")} />
        <MenuItem label={tr("menu.view.resetZoom")} shortcut="Ctrl+0" onClick={() => command("resetZoom")} />
        <MenuSeparator />
        <MenuItem label={tr("menu.view.fullScreen")} shortcut="F11" onClick={() => command("toggleFullScreen")} />
      </TitleMenu>
      <TitleMenu label={tr("menu.help")} name="help" openMenu={openMenu} onToggle={setOpenMenu}>
        <MenuItem label={tr("menu.help.documentation")} onClick={() => command("openDocumentation")} />
        <MenuItem label={tr("menu.help.checkUpdates")} onClick={() => run(actions.onCheckUpdates)} />
        <MenuSeparator />
        <MenuItem label={tr("menu.help.about")} onClick={() => command("showAbout")} />
      </TitleMenu>
      {model.title ? <strong className="rm-app-titlebar-title">{model.title}</strong> : null}
    </header>
  );
}

function TitleMenu({ label, name, openMenu, onToggle, children }: {
  label: string;
  name: MenuName;
  openMenu: MenuName | null;
  onToggle(value: MenuName | null): void;
  children: ReactNode;
}) {
  const open = openMenu === name;
  return (
    <div className="rm-title-menu">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => onToggle(open ? null : name)}>{label}</button>
      {open && <div className="rm-title-menu-popup" role="menu">{children}</div>}
    </div>
  );
}

function MenuItem({ label, shortcut, disabled = false, onClick }: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return <button className="rm-title-menu-item" type="button" role="menuitem" disabled={disabled} onClick={onClick}><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
}

function MenuSeparator() {
  return <div className="rm-title-menu-separator" role="separator" />;
}
