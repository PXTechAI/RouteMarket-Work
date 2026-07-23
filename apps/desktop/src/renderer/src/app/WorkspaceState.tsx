import type { ReactNode } from "react";

export function WorkspaceState({
  kind,
  icon,
  title,
  description,
  action,
  compact = false
}: {
  kind: "empty" | "loading";
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  if (kind === "loading") {
    return (
      <div
        className={`rm-workspace-state loading${compact ? " compact" : ""}`}
        role="status"
        aria-busy="true"
        aria-label={title}
      >
        <div className="rm-state-skeleton-icon" />
        <div className="rm-state-skeleton-line wide" />
        <div className="rm-state-skeleton-line" />
        <span>{title}</span>
      </div>
    );
  }

  return (
    <div className={`rm-workspace-state${compact ? " compact" : ""}`}>
      {icon && <div className="rm-workspace-state-icon">{icon}</div>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
