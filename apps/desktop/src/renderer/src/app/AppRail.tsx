import { Bot, ChevronRight, ChevronsLeft, ChevronsRight, ExternalLink, Folder, FolderOpen, FolderPlus, MessageSquarePlus, MoreHorizontal, MoveRight, Pencil, Plug, Settings, Trash2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalProjectChatSummary, WorkState } from "../../../shared/desktop-api";
import { projectFolderAvailable, projectFolderLabel, projectFolderStatus } from "../features/projects/project-folder-status";
import { AccountMenu } from "./AccountMenu";
import { tr } from "../i18n";
import { getCollapsedProjectIdsPreference, getCollapsedRailSectionsPreference, getRailExpandedPreference, setCollapsedProjectIdsPreference, setCollapsedRailSectionsPreference, setRailExpandedPreference, type CollapsibleRailSection } from "./rail-preference";
import { AppDialog } from "./AppDialog";
type RailView = "chat" | "workflow" | "agent" | "mcp" | "settings";
type ChatDialogState = { kind: "rename" | "move" | "delete"; chat: LocalProjectChatSummary } | null;

export function getGeneralRecentChats(chats: LocalProjectChatSummary[]): LocalProjectChatSummary[] {
    return chats.filter((chat) => chat.localProjectId === null);
}

export function AppRail({ activeView, state, selectedProjectId, selectedSessionId, projectChats, recentChats, authBusy, onSelect, onCreateProject, onCreateChat, onSelectProject, onSelectChat, onRenameChat, onMoveChat, onDeleteChat, onAttachProjectFolder, onOpenProjectFolder, onEditProject, onDeleteProject, onSignIn, onSignOut, onSwitchSpace, onUpgrade, onTopUpCredits, onOpenCreditsUsage, onOpenAccountCenter }: {
    activeView: string;
    state: WorkState;
    selectedProjectId: string | null;
    selectedSessionId: string | null;
    projectChats: Record<string, LocalProjectChatSummary[]>;
    recentChats: LocalProjectChatSummary[];
    authBusy: boolean;
    onSelect(view: RailView): void;
    onCreateProject(): void;
    onCreateChat(projectId: string | null): void;
    onSelectProject(projectId: string): void;
    onSelectChat(projectId: string | null, sessionId: string): void;
    onRenameChat(projectId: string | null, sessionId: string, title: string): void;
    onMoveChat(projectId: string | null, sessionId: string, targetProjectId: string | null): void;
    onDeleteChat(projectId: string | null, sessionId: string): void;
    onAttachProjectFolder(projectId: string): void;
    onOpenProjectFolder(projectId: string): void;
    onEditProject(projectId: string): void;
    onDeleteProject(projectId: string): void;
    onSignIn(): void;
    onSignOut(): void;
    onSwitchSpace(spaceId: string): Promise<boolean>;
    onUpgrade(): void;
    onTopUpCredits(): void;
    onOpenCreditsUsage(): void;
    onOpenAccountCenter(): void;
}) {
    const [expanded, setExpanded] = useState(getRailExpandedPreference);
    const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
    const [menuChatId, setMenuChatId] = useState<string | null>(null);
    const [chatDialog, setChatDialog] = useState<ChatDialogState>(null);
    const [chatDialogValue, setChatDialogValue] = useState("");
    const projectTreeScope = state.account?.activeSpaceId ?? state.account?.id ?? "guest";
    const [collapsedProjectIds, setCollapsedProjectIds] = useState(() => getCollapsedProjectIdsPreference(projectTreeScope));
    const [collapsedRailSections, setCollapsedRailSections] = useState(() => getCollapsedRailSectionsPreference(projectTreeScope));
    useEffect(() => {
        setCollapsedProjectIds(getCollapsedProjectIdsPreference(projectTreeScope));
        setCollapsedRailSections(getCollapsedRailSectionsPreference(projectTreeScope));
    }, [projectTreeScope]);
    useEffect(() => {
        if (!menuProjectId && !menuChatId)
            return;
        const close = () => { setMenuProjectId(null); setMenuChatId(null); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [menuProjectId, menuChatId]);
    useEffect(() => {
        const toggle = () => toggleExpanded();
        window.addEventListener("routemarket:toggle-rail", toggle);
        return () => window.removeEventListener("routemarket:toggle-rail", toggle);
    }, []);
    function toggleExpanded() {
        setExpanded((current) => {
            const next = !current;
            setRailExpandedPreference(next);
            return next;
        });
    }
    function toggleProject(projectId: string) {
        setCollapsedProjectIds((current) => {
            const next = new Set(current);
            if (next.has(projectId))
                next.delete(projectId);
            else
                next.add(projectId);
            setCollapsedProjectIdsPreference(projectTreeScope, next);
            return next;
        });
    }
    function toggleRailSection(section: CollapsibleRailSection) {
        setCollapsedRailSections((current) => {
            const next = new Set(current);
            if (next.has(section))
                next.delete(section);
            else
                next.add(section);
            setCollapsedRailSectionsPreference(projectTreeScope, next);
            return next;
        });
    }
    const selectedProject = state.projects.find((project) => project.localProjectId === selectedProjectId);
    const selectedFolderAvailable = selectedProject
        ? projectFolderAvailable(selectedProject)
        : true;
    const generalRecentChats = getGeneralRecentChats(recentChats);
    const chatDialogChoices = chatDialog?.kind === "move" ? [
        { id: null, name: tr("chat.general") },
        ...state.projects.map((project) => ({ id: project.localProjectId, name: project.displayName }))
    ].filter((choice) => choice.id !== chatDialog.chat.localProjectId) : [];
    function openChatDialog(kind: NonNullable<ChatDialogState>["kind"], chat: LocalProjectChatSummary) {
        const moveChoices = [
            { id: null, name: tr("chat.general") },
            ...state.projects.map((project) => ({ id: project.localProjectId, name: project.displayName }))
        ].filter((choice) => choice.id !== chat.localProjectId);
        setMenuChatId(null);
        setChatDialogValue(kind === "rename" ? chat.title : kind === "move" ? moveChoices[0]?.id ?? "__general__" : "");
        setChatDialog({ kind, chat });
    }
    function submitChatDialog() {
        if (!chatDialog) return;
        const { chat, kind } = chatDialog;
        if (kind === "rename") {
            const title = chatDialogValue.trim();
            if (!title) return;
            onRenameChat(chat.localProjectId, chat.sessionId, title);
        } else if (kind === "move") {
            const targetProjectId = chatDialogValue === "__general__" ? null : chatDialogValue;
            onMoveChat(chat.localProjectId, chat.sessionId, targetProjectId);
        } else {
            onDeleteChat(chat.localProjectId, chat.sessionId);
        }
        setChatDialog(null);
    }
    function renderChatMenu(chat: LocalProjectChatSummary, menuKey: string) {
        const choices = [
            { id: null, name: tr("chat.general") },
            ...state.projects.map((project) => ({ id: project.localProjectId, name: project.displayName }))
        ].filter((choice) => choice.id !== chat.localProjectId);
        return (<>
          <button className="rm-project-chat-action" type="button" aria-label={tr("chat.menu")} aria-expanded={menuChatId === menuKey} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setMenuProjectId(null); setMenuChatId((current) => current === menuKey ? null : menuKey); }}><MoreHorizontal size={14}/></button>
          {menuChatId === menuKey && <div className="rm-project-menu rm-chat-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => openChatDialog("rename", chat)}><Pencil size={14}/>{tr("chat.rename")}</button>
            {choices.length > 0 && <button type="button" role="menuitem" onClick={() => openChatDialog("move", chat)}><MoveRight size={14}/>{tr("chat.move")}</button>}
            <button className="danger" type="button" role="menuitem" onClick={() => openChatDialog("delete", chat)}><Trash2 size={14}/>{tr("chat.delete")}</button>
          </div>}
        </>);
    }
    return (<nav className={`rm-rail ${expanded ? "expanded" : ""}`} aria-label={tr("ui.fb1c7dc70a99")}>
      <div className="rm-rail-group">
        <span className="rm-rail-group-label">{tr("ui.a1ff8da47d74")}</span>
        <RailButton label={tr("nav.newChat")} onClick={() => onCreateChat(null)}>
          <MessageSquarePlus size={18}/>
        </RailButton>
        <RailButton label={tr("ui.cc19798b0c12")} active={activeView === "workflow"} onClick={() => onSelect("workflow")}>
          <Workflow size={18}/>
        </RailButton>
      </div>

      <section className={`rm-rail-projects rm-rail-recent ${collapsedRailSections.has("recent") ? "section-collapsed" : ""}`} aria-label={tr("chat.recent")}>
        <div className="rm-rail-projects-heading"><button className="rm-rail-section-toggle" type="button" aria-expanded={!collapsedRailSections.has("recent")} onClick={() => toggleRailSection("recent")}><ChevronRight size={13}/><span>{tr("chat.recent")}</span></button></div>
        <div className="rm-rail-project-list" hidden={collapsedRailSections.has("recent")}>
          {generalRecentChats.map((chat) => {
            const active = selectedSessionId === chat.sessionId && selectedProjectId === chat.localProjectId;
            return (<div className={`rm-project-chat-item rm-recent-chat-item ${active ? "active" : ""}`} key={chat.sessionId}>
              <button className="rm-project-chat-row" aria-current={active ? "page" : undefined} type="button" onClick={() => onSelectChat(chat.localProjectId, chat.sessionId)}>
                <span className="rm-recent-chat-copy">{chat.title || tr("chat.agent.none")}</span>
              </button>
              {renderChatMenu(chat, `recent:${chat.sessionId}`)}
            </div>);
          })}
        </div>
      </section>

      <section className={`rm-rail-projects ${collapsedRailSections.has("projects") ? "section-collapsed" : ""}`} aria-label={tr("ui.22336e6b892f")}>
        <div className="rm-rail-projects-heading">
          <button className="rm-rail-section-toggle" type="button" aria-expanded={!collapsedRailSections.has("projects")} onClick={() => toggleRailSection("projects")}><ChevronRight size={13}/><span>{tr("ui.22336e6b892f")}</span></button>
          <button type="button" title={tr("ui.80f5dfd187ff")} onClick={onCreateProject}>
            <FolderPlus size={15}/>
          </button>
        </div>
        <div className="rm-rail-project-list" hidden={collapsedRailSections.has("projects")}>
          {state.projects.map((project) => {
            const folderStatus = projectFolderStatus(project);
            const folderAvailable = projectFolderAvailable(project);
            const active = project.localProjectId === selectedProjectId;
            const projectCollapsed = collapsedProjectIds.has(project.localProjectId);
            const projectChatListId = `project-chats-${project.localProjectId}`;
            return (<div className={`rm-rail-project-entry ${active ? "active" : ""} ${projectCollapsed ? "collapsed" : ""}`} key={project.localProjectId}>
                <div className="rm-rail-project-row">
                  <button className="rm-project-disclosure" type="button" title={project.displayName} aria-label={project.displayName} aria-expanded={!projectCollapsed} aria-controls={projectChatListId} onClick={() => toggleProject(project.localProjectId)}>
                    <ChevronRight size={13}/>
                  </button>
                  <button className="rm-rail-project-main" type="button" title={project.displayName} onClick={() => onSelectProject(project.localProjectId)}>
                    {projectCollapsed ? <Folder size={15}/> : <FolderOpen size={15}/>}
                    <span>{project.displayName}</span>
                  </button>
                  <button className="rm-rail-project-action rm-project-create-chat" type="button" title={tr("nav.newChat")} aria-label={tr("nav.newChat")} onPointerDown={(event) => event.stopPropagation()} onClick={() => onCreateChat(project.localProjectId)}>
                    <MessageSquarePlus size={15}/>
                  </button>
                  <button className="rm-rail-project-action" type="button" aria-label={tr("project.menu")} aria-expanded={menuProjectId === project.localProjectId} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setMenuChatId(null); setMenuProjectId((current) => current === project.localProjectId ? null : project.localProjectId); }}>
                    <MoreHorizontal size={15}/>
                  </button>
                  {menuProjectId === project.localProjectId && (<div className="rm-project-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
                      {folderAvailable ? (<button type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onOpenProjectFolder(project.localProjectId); }}><ExternalLink size={14}/>{tr("project.openFolder")}</button>) : (<button type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onAttachProjectFolder(project.localProjectId); }}><FolderPlus size={14}/>{folderStatus === "unlinked" ? tr("ui.fd48bc5b93ea") : tr("ui.4cf9e92ce2e9")}</button>)}
                      <button type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onEditProject(project.localProjectId); }}><Pencil size={14}/>{tr("project.edit")}</button>
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onDeleteProject(project.localProjectId); }}><Trash2 size={14}/>{tr("project.remove")}</button>
                    </div>)}
                </div>
                <div className="rm-project-chat-list" id={projectChatListId} hidden={projectCollapsed}>
                {(projectChats[project.localProjectId] ?? []).map((chat) => {
                const chatActive = active && selectedSessionId === chat.sessionId;
                return (<div className={`rm-project-chat-item ${chatActive ? "active" : ""}`} key={chat.sessionId}>
                    <button className="rm-project-chat-row" aria-current={chatActive ? "page" : undefined} type="button" onClick={() => onSelectChat(project.localProjectId, chat.sessionId)}><span>{chat.title || tr("chat.agent.none")}</span></button>
                    {renderChatMenu(chat, `project:${chat.sessionId}`)}
                  </div>);
                })}
                </div>
              </div>);
        })}
          {state.projects.length === 0 && (<button className="empty" type="button" onClick={onCreateProject}>
              <FolderPlus size={16}/>
              <span>{tr("ui.6a95986b73be")}</span>
            </button>)}
        </div>
      </section>

      <div className="rm-rail-group rm-rail-capabilities">
        <span className="rm-rail-group-label">{tr("ui.55cce3103f9a")}</span>
        <RailButton label="Agent" active={activeView === "agent"} onClick={() => onSelect("agent")}>
          <Bot size={18}/>
        </RailButton>
        <RailButton label="Local MCP" active={activeView === "mcp"} onClick={() => onSelect("mcp")}>
          <Plug size={18}/>
        </RailButton>
      </div>
      <div className="rm-rail-spacer"/>

      <RailButton label={tr("nav.settings")} active={activeView === "settings"} onClick={() => onSelect("settings")}>
        <Settings size={18}/>
      </RailButton>

      <RailButton label={expanded ? tr("ui.ae10326eeb86") : tr("ui.f4cbda2958cd")} onClick={toggleExpanded}>
        {expanded ? <ChevronsLeft size={18}/> : <ChevronsRight size={18}/>}
      </RailButton>
      <AccountMenu state={state} busy={authBusy} expanded={expanded} onSignIn={onSignIn} onSignOut={onSignOut} onSwitchSpace={onSwitchSpace} onUpgrade={onUpgrade} onTopUpCredits={onTopUpCredits} onOpenCreditsUsage={onOpenCreditsUsage} onOpenAccountCenter={onOpenAccountCenter}/>
      {chatDialog?.kind === "rename" && <AppDialog title={tr("chat.rename")} onClose={() => setChatDialog(null)} footer={<><button className="secondary-button" type="button" onClick={() => setChatDialog(null)}>{tr("project.cancel")}</button><button className="primary-button" type="button" disabled={!chatDialogValue.trim()} onClick={submitChatDialog}>{tr("project.save")}</button></>}>
          <label className="app-dialog-field"><span>{tr("chat.rename.label")}</span><input className="app-dialog-input" autoFocus maxLength={120} value={chatDialogValue} onChange={(event) => setChatDialogValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitChatDialog(); }}/></label>
        </AppDialog>}
      {chatDialog?.kind === "move" && <AppDialog title={tr("chat.move")} onClose={() => setChatDialog(null)} footer={<><button className="secondary-button" type="button" onClick={() => setChatDialog(null)}>{tr("project.cancel")}</button><button className="primary-button" type="button" onClick={submitChatDialog}>{tr("chat.move")}</button></>}>
          <label className="app-dialog-field"><span>{tr("chat.move.label")}</span><select className="app-dialog-select" autoFocus value={chatDialogValue} onChange={(event) => setChatDialogValue(event.target.value)}>{chatDialogChoices.map((choice) => <option key={choice.id ?? "__general__"} value={choice.id ?? "__general__"}>{choice.name}</option>)}</select></label>
        </AppDialog>}
      {chatDialog?.kind === "delete" && <AppDialog title={tr("chat.delete")} description={chatDialog.chat.title} width="small" onClose={() => setChatDialog(null)} footer={<><button className="secondary-button" type="button" onClick={() => setChatDialog(null)}>{tr("project.cancel")}</button><button className="app-dialog-danger-button" type="button" onClick={submitChatDialog}>{tr("chat.delete")}</button></>}>
          <div className="app-dialog-danger-copy">{tr("chat.delete.confirm")}</div>
        </AppDialog>}
    </nav>);
}
function RailButton({ label, active = false, disabled = false, badge, onClick, children }: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    badge?: string;
    onClick?(): void;
    children: React.ReactNode;
}) {
    const title = disabled && badge ? `${label}（${badge}）` : label;
    return (<button className={`rm-rail-button ${active ? "active" : ""}`} type="button" title={title} aria-label={title} aria-current={active ? "page" : undefined} disabled={disabled} onClick={onClick}>
      <span className="rm-rail-button-icon">{children}</span>
      <span className="rm-rail-button-label">{label}</span>
      {badge && <span className="rm-rail-button-badge">{badge}</span>}
    </button>);
}
