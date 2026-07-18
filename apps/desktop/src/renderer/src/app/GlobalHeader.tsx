import { ChevronRight } from "lucide-react";
import type { ActivityItem } from "../../../shared/desktop-api";
import { ActivityMenu } from "./ActivityMenu";

export function GlobalHeader({
  activeView,
  activities
}: {
  activeView: string;
  activities: ActivityItem[];
}) {
  return (
    <header className="rm-global-header">
      <div className="rm-global-context">
        <span className="rm-global-app-name">RouteMarket Work</span>
        <ChevronRight size={13} />
        <strong>{viewLabel(activeView)}</strong>
      </div>
      <div className="rm-global-spacer" />
      <ActivityMenu activities={activities} />
    </header>
  );
}

function viewLabel(view: string) {
  const labels: Record<string, string> = {
    chat: "对话",
    files: "项目文件",
    terminal: "本地终端",
    browser: "浏览器",
    workflow: "工作流",
    agent: "Agent",
    mcp: "Local MCP",
    changes: "更改审查",
    versions: "版本历史",
    approvals: "审批中心"
  };
  return labels[view] ?? "工作区";
}
