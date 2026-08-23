import "./chat-skills-control.scss";
import { Boxes, FileCode2, PlugZap, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DesktopAgentSkillAvailability } from "../../../../../shared/agent-skill-availability";
import { AgentSkillStatusList } from "../../agent/AgentSkillStatusList";
import {
  ProjectSkillsPanel,
  type ProjectSkillManagerActions
} from "../../project-skills/ProjectSkillsPanel";

export function ChatSkillsControl({
  agentSkills,
  projectSkillCount,
  projectSkillActions,
  disabled
}: {
  agentSkills: DesktopAgentSkillAvailability[];
  projectSkillCount: number;
  projectSkillActions: ProjectSkillManagerActions | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const availableAgentSkillCount = agentSkills.filter((item) => item.available).length;
  const total = availableAgentSkillCount + projectSkillCount;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="chat-skills-control" ref={rootRef}>
      <button
        type="button"
        className={`chat-skills-trigger${open ? " open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Skills</span>
        {total > 0 ? (
          <span className="chat-skills-icons" aria-hidden="true">
            <span><Sparkles size={13}/></span>
            {total > 1 ? <span><FileCode2 size={13}/></span> : null}
            {total > 2 ? <span><PlugZap size={13}/></span> : null}
          </span>
        ) : null}
        {total > 3 ? <small>+{total - 3}</small> : null}
      </button>

      {open ? (
        <div className="chat-skills-popover" role="dialog" aria-label="Skills">
          <header>
            <span><Boxes size={15}/></span>
            <div>
              <strong>Skills</strong>
              <small>{total > 0 ? `${total} 个可用能力` : "当前环境暂无可用能力"}</small>
            </div>
          </header>
          {agentSkills.length ? <AgentSkillStatusList items={agentSkills} compact/> : null}
          {projectSkillCount ? (
            <div className="chat-skills-project-count">
              <FileCode2 size={14}/>
              <span>当前项目已安装 {projectSkillCount} 个 Skill</span>
            </div>
          ) : null}
          {projectSkillActions ? <ProjectSkillsPanel actions={projectSkillActions}/> : null}
        </div>
      ) : null}
    </div>
  );
}
