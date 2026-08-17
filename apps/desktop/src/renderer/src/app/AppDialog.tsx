import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { tr } from "../i18n";
import "./app-dialog.css";

export function AppDialog({ title, description, children, footer, onClose, width = "medium", className = "" }: {
  title: string;
  description?: string;
  children?: ReactNode;
  footer: ReactNode;
  onClose(): void;
  width?: "small" | "medium" | "large";
  className?: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`app-dialog app-dialog-${width} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="app-dialog-header">
          <div>
            <h2 id="app-dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="app-dialog-close" type="button" title={tr("ui.6c14bd7f6f9e")} aria-label={tr("ui.6c14bd7f6f9e")} onClick={onClose}><X size={18}/></button>
        </header>
        {children && <div className="app-dialog-body">{children}</div>}
        <footer className="app-dialog-footer">{footer}</footer>
      </section>
    </div>
  );
}
