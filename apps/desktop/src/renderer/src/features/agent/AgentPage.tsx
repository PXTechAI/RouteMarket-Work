import "./agent.scss";
import {
  Bot,
  CircleAlert,
  Cloud,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { tr } from "../../i18n";
import type { AgentPageActions, AgentPageModel } from "./types";

type AgentPageView = "marketplace" | "mine";

export function AgentPage({
  model,
  actions,
  onOpenMarketplace,
  onOpenCloudBuilder
}: {
  model: AgentPageModel;
  actions: AgentPageActions;
  onOpenMarketplace(): void;
  onOpenCloudBuilder(): void;
}) {
  const [view, setView] = useState<AgentPageView>("marketplace");
  const [search, setSearch] = useState("");
  const visibleAgents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return model.agents;
    return model.agents.filter((agent) =>
      [agent.name, agent.description ?? "", ...agent.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    );
  }, [model.agents, search]);

  return (
    <section className="agent-market-page">
      <header className="capability-page-header">
        <div>
          <h2>{tr("settings.extensions.agent.title")}</h2>
          <p>{tr("settings.extensions.agent.description")}</p>
        </div>
        <div className="capability-view-switch" role="tablist" aria-label={tr("settings.extensions.agent.viewLabel")}>
          <button className={view === "marketplace" ? "active" : ""} type="button" onClick={() => setView("marketplace")}>
            <Sparkles size={15}/>{tr("settings.extensions.agent.marketplace")}
          </button>
          <button className={view === "mine" ? "active" : ""} type="button" onClick={() => setView("mine")}>
            <Bot size={15}/>{tr("settings.extensions.agent.mine")}<span>{model.agents.length}</span>
          </button>
        </div>
      </header>

      {view === "marketplace" ? (
        <div className="agent-market-grid">
          <article className="agent-market-card primary">
            <span className="agent-market-card-icon"><Sparkles size={22}/></span>
            <div>
              <span className="capability-eyebrow">Marketplace</span>
              <h3>{tr("settings.extensions.agent.discoverTitle")}</h3>
              <p>{tr("settings.extensions.agent.discoverDescription")}</p>
            </div>
            <button className="primary-button" type="button" onClick={onOpenMarketplace}>
              {tr("settings.extensions.agent.openMarketplace")}<ExternalLink size={14}/>
            </button>
          </article>
          <article className="agent-market-card">
            <span className="agent-market-card-icon"><Cloud size={22}/></span>
            <div>
              <span className="capability-eyebrow">Agent Builder</span>
              <h3>{tr("settings.extensions.agent.createTitle")}</h3>
              <p>{tr("settings.extensions.agent.createDescription")}</p>
            </div>
            <button className="secondary-button" type="button" onClick={onOpenCloudBuilder}>
              {tr("settings.extensions.agent.openBuilder")}<ExternalLink size={14}/>
            </button>
          </article>
        </div>
      ) : (
        <section className="agent-library">
          <div className="capability-toolbar">
            <label className="capability-search">
              <Search size={16}/>
              <input value={search} placeholder={tr("settings.extensions.agent.search")} onChange={(event) => setSearch(event.target.value)}/>
            </label>
            <button className="secondary-button" type="button" disabled={model.agentsLoading || model.authStatus !== "signed_in"} onClick={actions.onRefreshAgents}>
              <RefreshCw className={model.agentsLoading ? "spin" : ""} size={14}/>{tr("settings.extensions.agent.refresh")}
            </button>
            <button className="primary-button" type="button" onClick={onOpenCloudBuilder}>
              <Sparkles size={14}/>{tr("settings.extensions.agent.create")}
            </button>
          </div>

          {model.authStatus !== "signed_in" ? (
            <AgentEmpty icon={<Cloud size={24}/>} title={tr("settings.extensions.agent.signInTitle")} description={tr("settings.extensions.agent.signInDescription")}/>
          ) : model.agentsLoading && model.agents.length === 0 ? (
            <AgentEmpty icon={<LoaderCircle className="spin" size={24}/>} title={tr("settings.extensions.agent.loading")} description=""/>
          ) : visibleAgents.length === 0 ? (
            <AgentEmpty icon={<Bot size={24}/>} title={tr("settings.extensions.agent.emptyTitle")} description={tr("settings.extensions.agent.emptyDescription")}/>
          ) : (
            <div className="agent-card-grid">
              {visibleAgents.map((agent) => (
                <button
                  key={agent.id}
                  className={agent.id === model.selectedAgentId ? "agent-card active" : "agent-card"}
                  type="button"
                  onClick={() => actions.onSelectAgent(agent.id)}
                >
                  <div className="agent-card-heading">
                    <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl}/>
                    <span><strong>{agent.name}</strong><small>{agent.origin === "personal" ? tr("settings.extensions.agent.personal") : tr("settings.extensions.agent.template")}</small></span>
                    {agent.id === model.selectedAgentId && <em>{tr("settings.extensions.agent.inUse")}</em>}
                  </div>
                  <p>{agent.description || tr("settings.extensions.agent.noDescription")}</p>
                  <div className="agent-card-meta">
                    <span><Wrench size={13}/>{agent.tools.length} {tr("settings.extensions.agent.tools")}</span>
                    <span><Sparkles size={13}/>{agent.skills.length} Skill</span>
                    <span><ShieldCheck size={13}/>{executionLabel(agent.executionPolicy.environment)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {model.error && (
        <div className="error-banner" role="alert">
          <CircleAlert size={18}/><span>{model.error}</span>
          <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={actions.onDismissError}><X size={14}/></button>
        </div>
      )}
    </section>
  );
}

function AgentEmpty({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="capability-empty"><span>{icon}</span><strong>{title}</strong>{description && <p>{description}</p>}</div>;
}

function AgentAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="agent-avatar" aria-hidden="true">
      {avatarUrl && !failed
        ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
        : (name.trim().slice(0, 1).toLocaleUpperCase() || "A")}
    </span>
  );
}

function executionLabel(environment: "auto" | "local" | "cloud"): string {
  if (environment === "local") return tr("settings.ai.execution.local");
  if (environment === "cloud") return tr("settings.ai.execution.cloud");
  return tr("settings.ai.execution.auto");
}
