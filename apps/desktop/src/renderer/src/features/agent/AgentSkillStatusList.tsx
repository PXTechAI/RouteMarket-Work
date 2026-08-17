import { tr } from "../../i18n";
import { CheckCircle2, CircleAlert, ChevronDown, MinusCircle } from "lucide-react";
import type { DesktopAgentSkillAvailability } from "../../../../shared/agent-skill-availability";
export function AgentSkillStatusList({ items, compact = false }: {
    items: DesktopAgentSkillAvailability[];
    compact?: boolean;
}) {
    if (!items.length)
        return null;
    const availableCount = items.filter((item) => item.available).length;
    const unavailableCount = items.length - availableCount;
    return (<details className={`agent-skill-status-list${compact ? " compact" : ""}`}>
      <summary title={tr("ui.e50740193cef")}>
        <span>
          Agent Skills · {availableCount}{tr("ui.e91365cf9ed9")}{unavailableCount ? tr("ui.400abeeb3186", [unavailableCount]) : ""}
        </span>
        <ChevronDown size={12}/>
      </summary>
      <div className="agent-skill-status-menu">
        {items.map((item) => (<div className={item.available ? "available" : item.status} key={`${item.skill.source}:${item.skill.skillId}`}>
            {item.available ? (<CheckCircle2 size={13}/>) : item.status === "disabled" ? (<MinusCircle size={13}/>) : (<CircleAlert size={13}/>)}
            <span>
              <strong>{item.skill.name || item.skill.skillId}</strong>
              <small>
                {item.available
                ? tr("ui.beb14b218175", [item.projectSkill?.relativePath]) : item.reason}
              </small>
            </span>
          </div>))}
      </div>
    </details>);
}
