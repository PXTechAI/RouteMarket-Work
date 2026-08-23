import "./mcp.scss";
import {
  BookOpen,
  Check,
  CircleAlert,
  Cloud,
  Code2,
  LoaderCircle,
  Play,
  Plug,
  Server,
  Settings2,
  Square,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { McpServerSummary } from "../../../../shared/desktop-api";
import { tr } from "../../i18n";

type McpView = "featured" | "installed" | "custom";

const FEATURED_MCP = [
  { id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", tools: 3, descriptionKey: "settings.extensions.mcp.catalog.deepwiki", icon: <BookOpen size={20}/>, color: "#6d5dfc" },
  { id: "microsoft-learn", name: "Microsoft Learn", url: "https://learn.microsoft.com/api/mcp", tools: 3, descriptionKey: "settings.extensions.mcp.catalog.microsoft-learn", icon: <Code2 size={20}/>, color: "#2563eb" },
  { id: "cloudflare-docs", name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp", tools: 2, descriptionKey: "settings.extensions.mcp.catalog.cloudflare-docs", icon: <Cloud size={20}/>, color: "#f48120" },
  { id: "context7", name: "Context7", url: "https://mcp.context7.com/mcp", tools: 2, descriptionKey: "settings.extensions.mcp.catalog.context7", icon: <Wrench size={20}/>, color: "#111827" }
] as const;

export type McpPageModel = {
  transport: "stdio" | "streamable-http";
  name: string;
  command: string;
  busy: boolean;
  servers: McpServerSummary[];
  selectedServer: McpServerSummary | null;
  selectedTool: McpServerSummary["tools"][number] | null;
  toolArgs: string;
  result: string;
  error: string | null;
  scopeLabel: string;
};

export type McpPageActions = {
  onTransportChange(value: "stdio" | "streamable-http"): void;
  onNameChange(value: string): void;
  onCommandChange(value: string): void;
  onInstall(): void;
  onInstallFeatured(name: string, url: string): void;
  onSelectServer(server: McpServerSummary): void;
  onToggleServer(): void;
  onRemoveServer(): void;
  onSelectTool(toolName: string): void;
  onToolArgsChange(value: string): void;
  onCallTool(): void;
  onDismissError(): void;
};

export function McpPage({ model, actions }: { model: McpPageModel; actions: McpPageActions }) {
  const [view, setView] = useState<McpView>("featured");
  return (
    <section className="mcp-market-page">
      <header className="capability-page-header">
        <div>
          <h2>{tr("settings.extensions.mcp.title")}</h2>
          <p>{tr("settings.extensions.mcp.description")}</p>
        </div>
        <div className="capability-view-switch mcp-view-switch" role="tablist" aria-label={tr("settings.extensions.mcp.viewLabel")}>
          <button className={view === "featured" ? "active" : ""} type="button" onClick={() => setView("featured")}><Cloud size={15}/>{tr("settings.extensions.mcp.featured")}</button>
          <button className={view === "installed" ? "active" : ""} type="button" onClick={() => setView("installed")}><Server size={15}/>{tr("settings.extensions.mcp.installed")}<span>{model.servers.length}</span></button>
          <button className={view === "custom" ? "active" : ""} type="button" onClick={() => setView("custom")}><Settings2 size={15}/>{tr("settings.extensions.mcp.custom")}</button>
        </div>
      </header>

      {view === "featured" && (
        <div className="mcp-featured-grid">
          {FEATURED_MCP.map((item) => {
            const installed = model.servers.some((server) => server.url === item.url);
            return (
              <article className="mcp-featured-card" key={item.id}>
                <span className="mcp-featured-icon" style={{ "--mcp-color": item.color } as CSSProperties}>{item.icon}</span>
                <div><h3>{item.name}</h3><p>{tr(item.descriptionKey)}</p></div>
                <div className="mcp-featured-meta"><span><Wrench size={13}/>{item.tools} tools</span><code>Streamable HTTP</code></div>
                <button className={installed ? "secondary-button installed" : "primary-button"} type="button" disabled={installed || model.busy} onClick={() => actions.onInstallFeatured(item.name, item.url)}>
                  {installed ? <Check size={14}/> : model.busy ? <LoaderCircle className="spin" size={14}/> : <Plug size={14}/>}
                  {installed ? tr("settings.extensions.mcp.connected") : tr("settings.extensions.mcp.connect")}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {view === "custom" && (
        <section className="mcp-custom-card">
          <header><span><Plug size={20}/></span><div><h3>{tr("settings.extensions.mcp.addTitle")}</h3><p>{tr("settings.extensions.mcp.addDescription")}</p></div><em>{model.scopeLabel}</em></header>
          <div className="mcp-custom-form">
            <label><span>{tr("settings.extensions.mcp.transport")}</span><select value={model.transport} onChange={(event) => actions.onTransportChange(event.target.value as "stdio" | "streamable-http")}><option value="stdio">stdio</option><option value="streamable-http">Streamable HTTP</option></select></label>
            <label><span>{tr("settings.extensions.mcp.serverName")}</span><input value={model.name} placeholder={tr("ui.02448b8f9a51")} onChange={(event) => actions.onNameChange(event.target.value)}/></label>
            <label className="mcp-command-field"><span>{model.transport === "stdio" ? tr("settings.extensions.mcp.command") : tr("settings.extensions.mcp.url")}</span><input value={model.command} placeholder={model.transport === "stdio" ? tr("ui.49817b5eb39e") : tr("ui.570e85a9e905")} onChange={(event) => actions.onCommandChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") actions.onInstall(); }}/></label>
            <button className="primary-button" type="button" disabled={!model.name.trim() || !model.command.trim() || model.busy} onClick={actions.onInstall}>{model.busy ? <LoaderCircle className="spin" size={14}/> : <Plug size={14}/>}{tr("settings.extensions.mcp.add")}</button>
          </div>
        </section>
      )}

      {view === "installed" && (
        model.servers.length === 0 ? (
          <CapabilityEmpty icon={<Plug size={24}/>} title={tr("settings.extensions.mcp.emptyTitle")} description={tr("settings.extensions.mcp.emptyDescription")} action={<button className="primary-button" type="button" onClick={() => setView("featured")}>{tr("settings.extensions.mcp.browseFeatured")}</button>}/>
        ) : (
          <div className="mcp-installed-layout">
            <aside className="mcp-server-cards">
              {model.servers.map((server) => (
                <button key={server.serverId} className={server.serverId === model.selectedServer?.serverId ? "active" : ""} type="button" onClick={() => actions.onSelectServer(server)}>
                  <span className={`mcp-status ${server.status}`}/><strong>{server.name}</strong><small>{server.transport === "stdio" ? "stdio" : "HTTP"} · {server.tools.length} tools</small>
                </button>
              ))}
            </aside>
            <McpServerDetail model={model} actions={actions}/>
          </div>
        )
      )}

      {model.error && <div className="error-banner" role="alert"><CircleAlert size={18}/><span>{model.error}</span><button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={actions.onDismissError}><X size={14}/></button></div>}
    </section>
  );
}

function McpServerDetail({ model, actions }: { model: McpPageModel; actions: McpPageActions }) {
  if (!model.selectedServer) return <CapabilityEmpty icon={<Server size={24}/>} title={tr("settings.extensions.mcp.selectServer")} description=""/>;
  const server = model.selectedServer;
  return (
    <section className="mcp-server-detail">
      <header>
        <div><span className={`mcp-status ${server.status}`}/><h3>{server.name}</h3><code>{server.transport === "stdio" ? `${server.command} ${server.args.join(" ")}` : server.url}</code></div>
        <div><button className="secondary-button" type="button" disabled={model.busy} onClick={actions.onToggleServer}>{server.status === "online" ? <><Square size={12} fill="currentColor"/>{tr("ui.a17f70a8d3d6")}</> : <><Play size={12} fill="currentColor"/>{tr("ui.ebd26da42171")}</>}</button><button className="danger-icon-button" type="button" disabled={model.busy} title={tr("ui.014e9125fe4d")} onClick={actions.onRemoveServer}><Trash2 size={15}/></button></div>
      </header>
      {server.lastError && <div className="mcp-server-error">{server.lastError}</div>}
      <div className="mcp-tool-workspace">
        <div className="mcp-tool-cards"><span>{tr("settings.extensions.mcp.tools")}</span>{server.tools.map((tool) => <button key={tool.name} className={tool.name === model.selectedTool?.name ? "active" : ""} type="button" onClick={() => actions.onSelectTool(tool.name)}><strong>{tool.title ?? tool.name}</strong><small>{tool.description ?? tr("settings.extensions.mcp.noToolDescription")}</small></button>)}{server.status === "online" && server.tools.length === 0 && <p>{tr("ui.828f0dd16340")}</p>}</div>
        <div className="mcp-tool-runner">{model.selectedTool ? <><div><strong>{model.selectedTool.name}</strong><button className="primary-button" type="button" disabled={model.busy || server.status !== "online"} onClick={actions.onCallTool}>{model.busy ? <LoaderCircle className="spin" size={13}/> : <Play size={13}/>} {tr("ui.b1fb011bbffa")}</button></div><label>{tr("ui.8af554439dff")}</label><textarea value={model.toolArgs} spellCheck={false} onChange={(event) => actions.onToolArgsChange(event.target.value)}/><label>{tr("ui.50a3351c37b2")}</label><pre>{model.result || tr("ui.a39829fbe50d")}</pre></> : <CapabilityEmpty icon={<Wrench size={22}/>} title={tr("ui.dc2dfe354bac")} description=""/>}</div>
      </div>
    </section>
  );
}

function CapabilityEmpty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="capability-empty"><span>{icon}</span><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>;
}
