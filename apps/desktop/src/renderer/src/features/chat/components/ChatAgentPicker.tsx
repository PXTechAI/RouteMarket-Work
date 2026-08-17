import { tr } from "../../../i18n";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import type { DesktopAgentProfile } from "../../../../../shared/desktop-api";
import { AgentAvatar } from "./AgentAvatar";
export function ChatAgentPicker({ agents, selectedAgentId, loading, disabled, onSelect }: {
    agents: DesktopAgentProfile[];
    selectedAgentId: string;
    loading: boolean;
    disabled: boolean;
    onSelect(agentId: string): void;
}) {
    const [open, setOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    const selected = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
    useEffect(() => {
        if (!open)
            return;
        function closeFromOutside(event: MouseEvent) {
            if (!pickerRef.current?.contains(event.target as Node))
                setOpen(false);
        }
        function closeFromEscape(event: KeyboardEvent) {
            if (event.key === "Escape")
                setOpen(false);
        }
        document.addEventListener("mousedown", closeFromOutside);
        document.addEventListener("keydown", closeFromEscape);
        return () => {
            document.removeEventListener("mousedown", closeFromOutside);
            document.removeEventListener("keydown", closeFromEscape);
        };
    }, [open]);
    return (<div className="chat-agent-picker" ref={pickerRef}>
      <button className="chat-agent-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        {loading ? (<LoaderCircle className="chat-agent-picker-spinner" size={17}/>) : (<AgentAvatar name={selected?.name ?? "Agent"} avatarUrl={selected?.avatarUrl} size={20}/>)}
        <span>{loading ? tr("ui.f2e20877f447") : selected?.name ?? tr("chat.agent.none")}</span>
        <ChevronDown className={open ? "open" : ""} size={13}/>
      </button>

      {open && (<div className="chat-agent-picker-dropdown" role="listbox">
          <div className="chat-agent-picker-heading">{tr("chat.agent.accountGroup")}</div>
          {agents.length ? (agents.map((agent) => {
                const active = agent.id === selected?.id;
                return (<button className={`chat-agent-picker-option${active ? " active" : ""}`} type="button" role="option" aria-selected={active} key={agent.id} onClick={() => {
                        onSelect(agent.id);
                        setOpen(false);
                    }}>
                  <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} size={28}/>
                  <span>
                    <span className="chat-agent-picker-name-row">
                      <strong>{agent.name}</strong>
                      <small className="chat-agent-picker-origin">{tr(agent.origin === "template" ? "chat.agent.template" : "chat.agent.personal")}</small>
                    </span>
                    {agent.description ? <small>{agent.description}</small> : null}
                  </span>
                  {active ? <Check size={15}/> : null}
                </button>);
            })) : (<div className="chat-agent-picker-empty">
              {loading ? tr("ui.1d08846f05c5") : tr("ui.2f20102a7da0")}
            </div>)}
        </div>)}
    </div>);
}
