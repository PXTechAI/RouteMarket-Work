import { tr } from "../i18n";
import { ChevronRight } from "lucide-react";
import type { ActivityItem } from "../../../shared/desktop-api";
import { ActivityMenu } from "./ActivityMenu";
import { resolveBuildEnvironment } from "./build-environment";
export function GlobalHeader({ activeView, activities, onClearActivities }: {
    activeView: string;
    activities: ActivityItem[];
    onClearActivities(): void;
}) {
    const buildEnvironment = resolveBuildEnvironment(import.meta.env.MODE, import.meta.env.DEV);
    return (<header className="rm-global-header">
      <div className="rm-global-context">
        <span className="rm-global-app-name">RouteMarket Work</span>
        {buildEnvironment ? (<span className={`rm-build-environment rm-build-environment--${buildEnvironment.kind}`}>
            {buildEnvironment.label}
          </span>) : null}
        <ChevronRight size={13}/>
        <strong>{viewLabel(activeView)}</strong>
      </div>
      <div className="rm-global-spacer"/>
      <ActivityMenu activities={activities} onClear={onClearActivities}/>
    </header>);
}
function viewLabel(view: string) {
    const labels: Record<string, string> = {
        chat: tr("ui.00d4cbafeabc"),
        files: tr("ui.2b6b5d89b5fb"),
        terminal: tr("ui.9a594503b78e"),
        browser: tr("ui.88d650dd4f82"),
        workflow: tr("ui.cc19798b0c12"),
        agent: "Agent",
        mcp: "Local MCP",
        changes: tr("ui.5da4882fbc56"),
        versions: tr("ui.8770418ba3a0"),
        approvals: tr("ui.7de4083a0523")
    };
    return labels[view] ?? tr("ui.a1ff8da47d74");
}
