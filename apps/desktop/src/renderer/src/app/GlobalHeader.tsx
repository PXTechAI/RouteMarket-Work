import { Bell, Globe2, MessageSquare, Workflow } from "lucide-react";

type GlobalView = "chat" | "workflow" | "browser";

export function GlobalHeader({
  activeView,
  activityCount,
  onSelect
}: {
  activeView: string;
  activityCount: number;
  onSelect(view: GlobalView): void;
}) {
  return (
    <header className="rm-global-header">
      <div className="rm-global-brand">
        <strong>RouteMarket</strong>
        <span>Work</span>
      </div>
      <nav className="rm-global-tabs" aria-label="工作区">
        <GlobalTab
          active={activeView === "chat"}
          icon={<MessageSquare size={15} />}
          label="对话"
          onClick={() => onSelect("chat")}
        />
        <GlobalTab
          active={activeView === "workflow"}
          icon={<Workflow size={15} />}
          label="工作流"
          onClick={() => onSelect("workflow")}
        />
        <GlobalTab
          active={activeView === "browser"}
          icon={<Globe2 size={15} />}
          label="浏览器"
          onClick={() => onSelect("browser")}
        />
      </nav>
      <div className="rm-global-spacer" />
      <button className="rm-notification-button" type="button" title="本机活动">
        <Bell size={16} />
        <span>活动</span>
        {activityCount > 0 && <b>{activityCount}</b>}
      </button>
    </header>
  );
}
function GlobalTab({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className={`rm-global-tab ${active ? "active" : ""}`}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
