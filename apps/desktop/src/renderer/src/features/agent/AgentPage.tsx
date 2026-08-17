import { tr } from "../../i18n";
import { Bot, CircleAlert, FolderPlus, LoaderCircle, RefreshCw, Send, ShieldCheck, Square, Wrench, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { resolveDesktopAgentSkillAvailability } from "../../../../shared/agent-skill-availability";
import type { AgentLocalToolGroup } from "../../../../shared/desktop-api";
import { ChatMessageRow } from "../chat/components/ChatMessageRow";
import { ModelPicker } from "../chat/components/ModelPicker";
import { VirtualMessageList } from "../chat/VirtualMessageList";
import { WorkspaceState } from "../../app/WorkspaceState";
import { AgentSkillStatusList } from "./AgentSkillStatusList";
import type { AgentPageActions, AgentPageModel } from "./types";
const LOCAL_TOOL_GROUPS: Array<{
    id: AgentLocalToolGroup;
    label: string;
}> = [
    { id: "files", label: tr("ui.2b6b5d89b5fb") },
    { id: "processes", label: tr("ui.42540fd5378c") },
    { id: "browser", label: tr("ui.2e345cfee36f") },
    { id: "mcp", label: "Local MCP" },
    { id: "skills", label: tr("ui.25715427b083") }
];
export function AgentPage({ model, actions }: {
    model: AgentPageModel;
    actions: AgentPageActions;
}) {
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);
    const latestMessage = model.messages.at(-1);
    useEffect(() => {
        const scroller = chatScrollRef.current;
        if (!scroller)
            return;
        stickToBottomRef.current = true;
        const updateStickiness = () => {
            stickToBottomRef.current =
                scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
        };
        scroller.addEventListener("scroll", updateStickiness, { passive: true });
        return () => scroller.removeEventListener("scroll", updateStickiness);
    }, [model.selectedProject?.localProjectId]);
    useEffect(() => {
        if (!stickToBottomRef.current)
            return;
        const scroller = chatScrollRef.current;
        if (!scroller)
            return;
        const frame = window.requestAnimationFrame(() => {
            scroller.scrollTop = scroller.scrollHeight;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [
        model.messages.length,
        latestMessage?.content,
        latestMessage?.tools?.length,
        latestMessage?.tools?.at(-1)?.status,
        model.activeRequestId
    ]);
    function sendFromComposer() {
        stickToBottomRef.current = true;
        actions.onSend();
    }
    if (!model.selectedProject) {
        return (<section className="agent-pane agent-blank">
        <WorkspaceState kind="empty" icon={<FolderPlus size={24}/>} title={tr("ui.bd5d09597ffa")} description={tr("ui.93271a57cd22")} action={(<button className="primary-button" type="button" onClick={actions.onChooseProject}>
              <FolderPlus size={15}/>{tr("ui.ed358091bc9c")}</button>)}/>
      </section>);
    }
    const agentSkills = resolveDesktopAgentSkillAvailability(model.selectedAgent?.skills ?? [], model.projectContext, {
        executionEnvironment: model.selectedAgent?.executionPolicy.environment === "cloud"
            ? "cloud"
            : "local",
        localSkillToolsEnabled: model.localToolGroups.includes("skills")
    });
    return (<section className="agent-pane">
      <aside className="agent-list">
        <div className="agent-list-header">
          <div>
            <strong>Agent</strong>
            <span>{model.agents.length}{tr("ui.1487ee86947c")}</span>
          </div>
          <button className="icon-button compact" type="button" title={tr("ui.d254dfda483d")} disabled={model.agentsLoading || model.authStatus !== "signed_in"} onClick={actions.onRefreshAgents}>
            <RefreshCw className={model.agentsLoading ? "spin" : ""} size={14}/>
          </button>
        </div>

        {model.authStatus !== "signed_in" ? (<div className="agent-list-empty">{tr("ui.b56d0d8ffa71")}</div>) : model.agentsLoading && model.agents.length === 0 ? (<div className="agent-list-empty">
            <LoaderCircle className="spin" size={18}/>{tr("ui.f2e20877f447")}</div>) : model.agents.length === 0 ? (<div className="agent-list-empty">{tr("ui.e60ab2970d34")}</div>) : (<div className="agent-list-items">
            {model.agents.map((agent) => (<button key={agent.id} className={agent.id === model.selectedAgentId ? "active" : ""} type="button" disabled={Boolean(model.activeRequestId)} onClick={() => actions.onSelectAgent(agent.id)}>
                <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl}/>
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.description || tr("ui.935c3b1c47c3")}</small>
                </span>
              </button>))}
          </div>)}
      </aside>

      <div className="agent-workspace">
        {model.selectedAgent ? (<>
            <header className="agent-profile-header">
              <AgentAvatar name={model.selectedAgent.name} avatarUrl={model.selectedAgent.avatarUrl} large/>
              <div className="agent-profile-copy">
                <h2>{model.selectedAgent.name}</h2>
                <p>{model.selectedAgent.description || tr("ui.8cef7a8df769")}</p>
                <div className="agent-profile-meta">
                  <span><Wrench size={12}/>{model.selectedAgent.tools.length}{tr("ui.4ed81b99bf21")}</span>
                  <span><ShieldCheck size={12}/>{tr("ui.b29d9408623b")}</span>
                </div>
              </div>
              <ModelPicker models={model.models} value={model.selectedModelCode} authStatus={model.authStatus} loading={model.modelsLoading} disabled={Boolean(model.activeRequestId)} onChange={actions.onModelChange}/>
            </header>

            <AgentSkillStatusList items={agentSkills}/>

            <div className="agent-policy-bar">
              <div className="agent-tool-policy">
                <span>{tr("ui.55cce3103f9a")}</span>
                {LOCAL_TOOL_GROUPS.map((group) => (<label key={group.id}>
                    <input type="checkbox" checked={model.localToolGroups.includes(group.id)} disabled={Boolean(model.activeRequestId)} onChange={(event) => actions.onToolGroupChange(group.id, event.target.checked)}/>
                    {group.label}
                  </label>))}
              </div>
              <label className="agent-round-limit">{tr("ui.d28b7ea4edf9")}<input type="number" min={1} max={8} value={model.maxToolRounds} disabled={Boolean(model.activeRequestId)} onChange={(event) => actions.onMaxToolRoundsChange(Number(event.target.value))}/>
              </label>
            </div>

            <div className="agent-chat-scroll" ref={chatScrollRef}>
              {model.messages.length ? (<VirtualMessageList messages={model.messages} scrollerRef={chatScrollRef} gap={0} renderMessage={(message) => (<ChatMessageRow key={message.id} message={message} streaming={message.id === `assistant:${model.activeRequestId}`}/>)}/>) : (<div className="agent-start">
                  <Bot size={27}/>
                  <h3>{model.selectedAgent.greeting || tr("ui.83a5da975277", [model.selectedAgent.name])}</h3>
                  {model.selectedAgent.starterQuestions.length > 0 && (<div className="agent-starters">
                      {model.selectedAgent.starterQuestions.slice(0, 4).map((question) => (<button key={question} type="button" onClick={() => actions.onUseStarterQuestion(question)}>
                          {question}
                        </button>))}
                    </div>)}
                </div>)}
            </div>

            <div className="agent-composer-shell">
              <div className="composer">
                <textarea value={model.draft} rows={3} disabled={model.authStatus !== "signed_in"} placeholder={tr("ui.0b423de3900a", [model.selectedAgent.name])} onChange={(event) => actions.onDraftChange(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendFromComposer();
                }
            }}/>
                <div className="composer-footer">
                  <span className="agent-composer-note">{tr("ui.fcf53ededee1")}</span>
                  {model.activeRequestId ? (<button className="send-button stop" type="button" title={tr("ui.bec8448d7eb0")} onClick={actions.onStop}>
                      <Square size={14} fill="currentColor"/>
                    </button>) : (<button className="send-button" type="button" title={tr("ui.1db2596f4f03")} disabled={!model.draft.trim() ||
                    !model.selectedModelCode ||
                    model.authStatus !== "signed_in"} onClick={sendFromComposer}>
                      <Send size={15}/>
                    </button>)}
                </div>
              </div>
            </div>
          </>) : (<div className="agent-workspace-empty">
            <Bot size={30}/>
            <h2>{tr("ui.25013cf41a29")}</h2>
            <p>{tr("ui.6b4d64f1bc70")}</p>
          </div>)}
      </div>

      {model.error && (<div className="error-banner" role="alert">
          <CircleAlert size={18}/>
          <span>{model.error}</span>
          <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={actions.onDismissError}>
            <X size={14}/>
          </button>
        </div>)}
    </section>);
}
function AgentAvatar({ name, avatarUrl, large = false }: {
    name: string;
    avatarUrl: string | null;
    large?: boolean;
}) {
    return (<span className={`agent-avatar ${large ? "large" : ""}`} aria-hidden="true">
      {avatarUrl ? (<img src={avatarUrl} alt="" referrerPolicy="no-referrer"/>) : (name.trim().slice(0, 1).toLocaleUpperCase() || "A")}
    </span>);
}
