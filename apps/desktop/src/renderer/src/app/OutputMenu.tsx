import "./output-menu.scss";
import {
  ChevronRight,
  FilePlus2,
  FileText,
  Globe2,
  ListTree,
  Plus,
  SquareTerminal
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ManagedBrowserState, ManagedProcessSummary, ProjectFileTree } from "../../../shared/desktop-api";
import { tr } from "../i18n";
import { buildOutputSources, sortOutputProcesses } from "./output-menu-data";
import { calculateOutputMenuPlacement, type OutputMenuPlacement } from "./output-menu-position";

type WorkbenchPanel = "files" | "terminal" | "browser";
type ActiveWorkbenchPanel = WorkbenchPanel | "conversation-files";

type OutputMenuProps = {
  activePanel: ActiveWorkbenchPanel | null;
  contextKey: string;
  disabled?: boolean;
  localFilesDisabled?: boolean;
  files: ProjectFileTree | null;
  processes: ManagedProcessSummary[];
  browserState: ManagedBrowserState | null;
  selectedFilePath: string | null;
  selectedProcessId: string | null;
  conversationSourcePaths: string[];
  onOpen: () => void;
  onRefreshProcesses: () => void;
  onCreateFile: () => void;
  onOpenPanel: (panel: WorkbenchPanel) => void;
  onViewAllSources: () => void;
  onOpenProcess: (processId: string) => void;
  onOpenFile: (relativePath: string) => void;
};

function processLabel(process: ManagedProcessSummary): string {
  return [process.executable, ...process.args].join(" ");
}

export function OutputMenu({
  activePanel,
  contextKey,
  disabled,
  localFilesDisabled,
  files,
  processes,
  browserState,
  selectedFilePath,
  selectedProcessId,
  conversationSourcePaths,
  onOpen,
  onRefreshProcesses,
  onCreateFile,
  onOpenPanel,
  onViewAllSources,
  onOpenProcess,
  onOpenFile
}: OutputMenuProps) {
  const [open, setOpen] = useState(false);
  const [showAllProcesses, setShowAllProcesses] = useState(false);
  const [placement, setPlacement] = useState<OutputMenuPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const refreshProcessesRef = useRef(onRefreshProcesses);
  refreshProcessesRef.current = onRefreshProcesses;
  const sourceFiles = useMemo(() => buildOutputSources(files, conversationSourcePaths), [conversationSourcePaths, files]);
  const sortedProcesses = useMemo(() => sortOutputProcesses(processes), [processes]);
  const visibleProcesses = showAllProcesses ? sortedProcesses : sortedProcesses.slice(0, 5);
  const hiddenProcessCount = Math.max(0, sortedProcesses.length - 5);

  useEffect(() => {
    setOpen(false);
    setShowAllProcesses(false);
  }, [contextKey]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
        setShowAllProcesses(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setShowAllProcesses(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPlacement(calculateOutputMenuPlacement(
      trigger.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      menuRef.current?.scrollHeight ?? 600
    ));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    updatePlacement();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePlacement);
    if (menuRef.current) observer?.observe(menuRef.current);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, showAllProcesses, updatePlacement]);

  useEffect(() => {
    if (!open || !placement) return;
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    firstItem?.focus();
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => refreshProcessesRef.current(), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const openPanel = (panel: WorkbenchPanel) => {
    setOpen(false);
    onOpenPanel(panel);
  };
  const position = triggerRef.current?.getBoundingClientRect();
  const menuStyle = placement ? {
    top: placement.top,
    bottom: placement.bottom,
    right: placement.right,
    maxHeight: placement.maxHeight
  } satisfies CSSProperties : undefined;
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return <>
    <button
      ref={triggerRef}
      className={open || activePanel ? "active" : ""}
      type="button"
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      title={tr("output.title")}
      onClick={() => {
        if (!open) onOpen();
        setOpen(!open);
        if (open) setShowAllProcesses(false);
      }}
    >
      <ListTree size={16}/>
    </button>
    {open && position && typeof document !== "undefined" && createPortal(
      <div
        ref={menuRef}
        className={`output-menu output-menu-${placement?.side ?? "bottom"}`}
        role="menu"
        aria-label={tr("output.title")}
        style={menuStyle ?? { top: position.bottom + 8, right: Math.max(12, window.innerWidth - position.right) }}
        onKeyDown={handleMenuKeyDown}
      >
        <div className="output-menu-heading">
          <strong>{tr("output.title")}</strong>
          <button type="button" disabled={localFilesDisabled} title={tr("output.createFile")} onClick={() => { setOpen(false); onCreateFile(); }}>
            <Plus size={18}/>
          </button>
        </div>
        <button className="output-menu-create" type="button" role="menuitem" disabled={localFilesDisabled} onClick={() => { setOpen(false); onCreateFile(); }}>
          <FilePlus2 size={16}/><span>{tr("output.createFile")}</span>
        </button>

        <section className="output-menu-section">
          <div className="output-menu-section-title">{tr("output.processes")}</div>
          {visibleProcesses.length ? visibleProcesses.map((process) => <button
            key={process.processId}
            className={`output-menu-row ${process.processId === selectedProcessId ? "active" : ""}`}
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenProcess(process.processId); }}
          >
            <SquareTerminal size={15}/>
            <span className="output-menu-row-label">{processLabel(process)}</span>
            <i className={`output-process-status ${process.status}`} aria-label={process.status}/>
          </button>) : <button className="output-menu-row" type="button" role="menuitem" disabled={localFilesDisabled} onClick={() => openPanel("terminal")}>
            <SquareTerminal size={15}/><span className="output-menu-row-label">{tr("output.openTerminal")}</span><ChevronRight size={14}/>
          </button>}
          {hiddenProcessCount > 0 && <button className="output-menu-more" type="button" onClick={() => setShowAllProcesses((current) => !current)}>
            {showAllProcesses ? tr("output.showLess") : tr("output.showMore", [hiddenProcessCount])}
          </button>}
        </section>

        <section className="output-menu-section">
          <div className="output-menu-section-title">{tr("output.computerUse")}</div>
          <button className={`output-menu-row ${activePanel === "browser" ? "active" : ""}`} type="button" role="menuitem" aria-current={activePanel === "browser" ? "page" : undefined} onClick={() => openPanel("browser")}>
            <Globe2 size={16}/>
            <span className="output-menu-row-label">{tr("workbench.browser")}</span>
            <span className="output-menu-row-meta">{browserState?.visible ? tr("output.active") : tr("output.open")}</span>
          </button>
        </section>

        <section className="output-menu-section">
          <div className="output-menu-section-heading">
            <span className="output-menu-section-title">{tr("output.sources")}</span>
            <button type="button" disabled={localFilesDisabled} title={tr("output.createFile")} onClick={() => { setOpen(false); onCreateFile(); }}><Plus size={17}/></button>
          </div>
          {sourceFiles.length ? sourceFiles.map((file) => <button
            key={file.relativePath}
            className={`output-menu-row ${file.relativePath === selectedFilePath ? "active" : ""}`}
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenFile(file.relativePath); }}
          >
            <FileText size={15}/><span className="output-menu-row-label">{file.name}</span>
          </button>) : <div className="output-menu-empty">{tr("output.noSources")}</div>}
          <button className={`output-menu-row output-menu-view-all ${activePanel === "conversation-files" && !selectedFilePath ? "active" : ""}`} type="button" role="menuitem" disabled={localFilesDisabled} onClick={() => { setOpen(false); onViewAllSources(); }}>
            <ListTree size={15}/><span className="output-menu-row-label">{tr("output.viewAll")}</span>
          </button>
        </section>
      </div>,
      document.body
    )}
  </>;
}
