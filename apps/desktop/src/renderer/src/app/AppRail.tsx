import { AudioLines, Box as BoxIcon, ChevronRight, Cpu, ExternalLink, Folder, FolderOpen, FolderPlus, History, Image, MessageSquarePlus, MoreHorizontal, MoveRight, PanelLeft, Pencil, Puzzle, Search, Settings, Sparkles, Trash2, Video, WandSparkles, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import "./app-rail.scss";
import "./app-rail-projects.scss";
import type { DesktopExtensionSummary, DesktopWorkflowDraftSummary, LocalProjectChatSummary, WorkState } from "../../../shared/desktop-api";
import { projectFolderAvailable, projectFolderLabel, projectFolderStatus } from "../features/projects/project-folder-status";
import { AccountMenu } from "./AccountMenu";
import { tr } from "../i18n";
import { getCollapsedProjectIdsPreference, getCollapsedRailSectionsPreference, getRailExpandedPreference, setCollapsedProjectIdsPreference, setCollapsedRailSectionsPreference, setRailExpandedPreference, type CollapsibleRailSection } from "./rail-preference";
import { AppDialog } from "./AppDialog";
import { RecentChatSearchDialog } from "./RecentChatSearchDialog";
type RailView = "chat" | "image" | "video" | "audio" | "workflow" | "settings";
type ChatDialogState = { kind: "rename" | "move" | "delete"; chat: LocalProjectChatSummary } | null;

export function getGeneralRecentChats(chats: LocalProjectChatSummary[]): LocalProjectChatSummary[] {
    return chats.filter((chat) => chat.localProjectId === null);
}

export function AppRail({ activeView, state, extensions, selectedProjectId, selectedSessionId, selectedWorkflowId, projectChats, projectWorkflows, recentChats, authBusy, onSelect, onSelectExtension, onOpenTools, onCreateProject, onCreateChat, onSelectProject, onSelectChat, onSelectWorkflow, onRenameChat, onMoveChat, onDeleteChat, onAttachProjectFolder, onOpenProjectFolder, onEditProject, onDeleteProject, onSignIn, onSignOut, onSwitchSpace, onUpgrade, onTopUpCredits, onOpenCreditsUsage, onOpenAccountCenter }: {
    activeView: string;
    state: WorkState;
    extensions: DesktopExtensionSummary[];
    selectedProjectId: string | null;
    selectedSessionId: string | null;
    selectedWorkflowId: string | null;
    projectChats: Record<string, LocalProjectChatSummary[]>;
    projectWorkflows: Record<string, DesktopWorkflowDraftSummary[]>;
    recentChats: LocalProjectChatSummary[];
    authBusy: boolean;
    onSelect(view: RailView): void;
    onSelectExtension(pluginId: string, pageId: string): void;
    onOpenTools(): void;
    onCreateProject(): void;
    onCreateChat(projectId: string | null): void;
    onSelectProject(projectId: string): void;
    onSelectChat(projectId: string | null, sessionId: string): void;
    onSelectWorkflow(projectId: string, workflowId: string): void;
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
    const [creatorGroupCollapsed, setCreatorGroupCollapsed] = useState(false);
    const [recentSearchOpen, setRecentSearchOpen] = useState(false);
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
    function expandRailSection(section: CollapsibleRailSection) {
        setCollapsedRailSections((current) => {
            if (!current.has(section)) return current;
            const next = new Set(current);
            next.delete(section);
            setCollapsedRailSectionsPreference(projectTreeScope, next);
            return next;
        });
    }
    function expandProject(projectId: string) {
        setCollapsedProjectIds((current) => {
            if (!current.has(projectId)) return current;
            const next = new Set(current);
            next.delete(projectId);
            setCollapsedProjectIdsPreference(projectTreeScope, next);
            return next;
        });
    }
    function revealChatLocation(projectId: string | null) {
        if (projectId === null) {
            expandRailSection("recent");
            return;
        }
        expandRailSection("projects");
        expandProject(projectId);
    }
    function createChat(projectId: string | null) {
        revealChatLocation(projectId);
        onCreateChat(projectId);
    }
    function selectChat(projectId: string | null, sessionId: string) {
        revealChatLocation(projectId);
        onSelectChat(projectId, sessionId);
    }
    const selectedProject = state.projects.find((project) => project.localProjectId === selectedProjectId);
    const creatorEntryActive = activeView === "chat" || activeView === "image" || activeView === "video" || activeView === "audio" || activeView === "workflow";
    const selectedFolderAvailable = selectedProject
        ? projectFolderAvailable(selectedProject)
        : true;
    const generalRecentChats = getGeneralRecentChats(recentChats);
    const chatMoveChoices = [
        { id: null, name: tr("chat.general") },
        ...state.projects.map((project) => ({ id: project.localProjectId, name: project.displayName }))
    ];
    const chatDialogChoices = chatDialog?.kind === "move" ? chatMoveChoices : [];
    const chatMoveTargetId = chatDialogValue === "__general__" ? null : chatDialogValue;
    const canMoveChat = chatDialog?.kind === "move" && chatMoveTargetId !== chatDialog.chat.localProjectId;
    const extensionNavigation = extensions.flatMap((extension) => extension.navigation.map((item) => ({
        ...item,
        pluginId: extension.pluginId,
        key: `plugin:${extension.pluginId}:${item.pageId}`
    }))).sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
    function openChatDialog(kind: NonNullable<ChatDialogState>["kind"], chat: LocalProjectChatSummary) {
        setMenuChatId(null);
        setChatDialogValue(kind === "rename" ? chat.title : kind === "move" ? chat.localProjectId ?? "__general__" : "");
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
            if (targetProjectId === chat.localProjectId) return;
            onMoveChat(chat.localProjectId, chat.sessionId, targetProjectId);
        } else {
            onDeleteChat(chat.localProjectId, chat.sessionId);
        }
        setChatDialog(null);
    }
    function renderChatMenu(chat: LocalProjectChatSummary, menuKey: string) {
        return (<>
          <button className="rm-project-chat-action" type="button" aria-label={tr("chat.menu")} aria-expanded={menuChatId === menuKey} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setMenuProjectId(null); setMenuChatId((current) => current === menuKey ? null : menuKey); }}><MoreHorizontal size={14}/></button>
          {menuChatId === menuKey && <div className="rm-project-menu rm-chat-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => openChatDialog("rename", chat)}><Pencil size={14}/>{tr("chat.rename")}</button>
            <button type="button" role="menuitem" onClick={() => openChatDialog("move", chat)}><MoveRight size={14}/>{tr("chat.move")}</button>
            <button className="danger" type="button" role="menuitem" onClick={() => openChatDialog("delete", chat)}><Trash2 size={14}/>{tr("chat.delete")}</button>
          </div>}
        </>);
    }
    return (<nav className={`rm-rail ${expanded ? "expanded" : ""}`} aria-label={tr("ui.fb1c7dc70a99")}>
      <div className="rm-rail-toolbar">
        <span className="rm-rail-toolbar-label">{tr("nav.creation")}</span>
        <button className={`rm-rail-toolbar-search ${recentSearchOpen ? "active" : ""}`} type="button" title={tr("chat.searchHistory")} aria-label={tr("chat.searchHistory")} aria-pressed={recentSearchOpen} onClick={() => setRecentSearchOpen(true)}><Search size={14}/></button>
        <button className="rm-rail-sidebar-toggle" type="button" title={expanded ? tr("ui.ae10326eeb86") : tr("ui.f4cbda2958cd")} aria-label={expanded ? tr("ui.ae10326eeb86") : tr("ui.f4cbda2958cd")} onClick={toggleExpanded}>
          <PanelLeft size={14}/>
        </button>
      </div>
      <div className={`rm-rail-group rm-rail-creation ${creatorGroupCollapsed ? "section-collapsed" : ""}`}>
        <button className={`rm-rail-creation-toggle ${creatorEntryActive ? "active" : ""}`} type="button" aria-expanded={!creatorGroupCollapsed} aria-controls="rm-rail-creation-items" onClick={() => setCreatorGroupCollapsed((current) => !current)}>
          <span className="rm-rail-creation-icon"><Sparkles size={14}/></span>
          <span className="rm-rail-creation-label">{tr("nav.creationWorkspace")}</span>
          <ChevronRight className="rm-rail-creation-chevron" size={12}/>
        </button>
        <div className="rm-rail-creation-items" id="rm-rail-creation-items" hidden={expanded && creatorGroupCollapsed}>
          <RailButton label={tr("nav.newChat")} active={activeView === "chat" && selectedSessionId === null} onClick={() => createChat(null)}>
            <MessageSquarePlus size={14}/>
          </RailButton>
          <RailButton label={tr("nav.imageCreation")} active={activeView === "image"} onClick={() => onSelect("image")}>
            <Image size={14}/>
          </RailButton>
          <RailButton label={tr("nav.videoCreation")} active={activeView === "video"} onClick={() => onSelect("video")}>
            <Video size={14}/>
          </RailButton>
          <RailButton label={tr("nav.audioGeneration")} active={activeView === "audio"} onClick={() => onSelect("audio")}>
            <AudioLines size={14}/>
          </RailButton>
          <RailButton label={tr("ui.cc19798b0c12")} active={activeView === "workflow"} onClick={() => onSelect("workflow")}>
            <Workflow size={14}/>
          </RailButton>
          {extensionNavigation.filter((item) => item.group === "creation").map((item) => (
            <RailButton key={item.key} label={item.title} active={activeView === item.key} onClick={() => onSelectExtension(item.pluginId, item.pageId)}>
              {extensionIcon(item.icon)}
            </RailButton>
          ))}
        </div>
      </div>

      <section className={`rm-rail-projects rm-rail-recent ${collapsedRailSections.has("recent") ? "section-collapsed" : ""}`} aria-label={tr("chat.recent")}>
        <div className="rm-rail-projects-heading rm-rail-recent-heading">
          <button className="rm-rail-recent-title" type="button" aria-expanded={!collapsedRailSections.has("recent")} onClick={() => toggleRailSection("recent")}><History className="rm-rail-section-icon" size={14}/><span>{tr("nav.recent")}</span></button>
          <button className="rm-rail-recent-collapse-trigger" type="button" title={tr("nav.recent")} aria-label={tr("nav.recent")} aria-expanded={!collapsedRailSections.has("recent")} onClick={() => toggleRailSection("recent")}><ChevronRight className="rm-rail-section-chevron" size={12}/></button>
        </div>
        <div className="rm-rail-project-list" hidden={collapsedRailSections.has("recent")}>
          {generalRecentChats.map((chat) => {
            const active = selectedSessionId === chat.sessionId && selectedProjectId === chat.localProjectId;
            return (<div className={`rm-project-chat-item rm-recent-chat-item ${active ? "active" : ""}`} key={chat.sessionId}>
              <button className="rm-project-chat-row" aria-current={active ? "page" : undefined} type="button" onClick={() => selectChat(chat.localProjectId, chat.sessionId)}>
                <span className="rm-recent-chat-bullet" aria-hidden="true"/>
                <span className="rm-recent-chat-copy">{chat.title || tr("chat.agent.none")}</span>
              </button>
              {renderChatMenu(chat, `recent:${chat.sessionId}`)}
            </div>);
          })}
        </div>
      </section>

      <section className={`rm-rail-projects ${collapsedRailSections.has("projects") ? "section-collapsed" : ""}`} aria-label={tr("ui.22336e6b892f")}>
        <div className="rm-rail-projects-heading rm-rail-projects-group-heading">
          <button className="rm-rail-project-create-trigger" type="button" title={tr("ui.80f5dfd187ff")} onClick={onCreateProject}>
            <span className="rm-rail-project-create-state rm-rail-project-create-default"><Folder size={14}/><span>{tr("ui.22336e6b892f")}</span></span>
            <span className="rm-rail-project-create-state rm-rail-project-create-hover"><FolderPlus size={14}/><span>{tr("ui.80f5dfd187ff")}</span></span>
          </button>
          <button className="rm-rail-projects-collapse-trigger" type="button" title={tr("ui.22336e6b892f")} aria-label={tr("ui.22336e6b892f")} aria-expanded={!collapsedRailSections.has("projects")} onClick={() => toggleRailSection("projects")}>
            <ChevronRight className="rm-rail-section-chevron" size={12}/>
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
                    <ChevronRight size={11}/>
                  </button>
                  <button className="rm-rail-project-main" type="button" title={project.displayName} onClick={() => onSelectProject(project.localProjectId)}>
                    {projectCollapsed ? <Folder size={13}/> : <FolderOpen size={13}/>}
                    <span>{project.displayName}</span>
                  </button>
                  <button className="rm-rail-project-action rm-project-create-chat" type="button" title={tr("nav.newChat")} aria-label={tr("nav.newChat")} onPointerDown={(event) => event.stopPropagation()} onClick={() => createChat(project.localProjectId)}>
                    <MessageSquarePlus size={13}/>
                  </button>
                  <button className="rm-rail-project-action" type="button" aria-label={tr("project.menu")} aria-expanded={menuProjectId === project.localProjectId} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setMenuChatId(null); setMenuProjectId((current) => current === project.localProjectId ? null : project.localProjectId); }}>
                    <MoreHorizontal size={13}/>
                  </button>
                  {menuProjectId === project.localProjectId && (<div className="rm-project-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
                      {folderAvailable ? (<button type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onOpenProjectFolder(project.localProjectId); }}><ExternalLink size={14}/>{tr("project.openFolder")}</button>) : (<button type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onAttachProjectFolder(project.localProjectId); }}><FolderPlus size={14}/>{folderStatus === "unlinked" ? tr("ui.fd48bc5b93ea") : tr("ui.4cf9e92ce2e9")}</button>)}
                      <button type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onEditProject(project.localProjectId); }}><Pencil size={14}/>{tr("project.edit")}</button>
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMenuProjectId(null); onDeleteProject(project.localProjectId); }}><Trash2 size={14}/>{tr("project.remove")}</button>
                    </div>)}
                </div>
                <div className="rm-project-chat-list" id={projectChatListId} hidden={projectCollapsed}>
                {(projectWorkflows[project.localProjectId] ?? []).map((workflow) => {
                const workflowActive = active && activeView === "workflow" && selectedWorkflowId === workflow.workflowId;
                return (<div className={`rm-project-chat-item rm-project-workflow-item ${workflowActive ? "active" : ""}`} key={workflow.workflowId}>
                    <button className="rm-project-chat-row rm-project-workflow-row" aria-current={workflowActive ? "page" : undefined} type="button" title={workflow.name} onClick={() => onSelectWorkflow(project.localProjectId, workflow.workflowId)}>
                      <Workflow size={13}/><span>{workflow.name}</span>
                    </button>
                  </div>);
                })}
                {(projectChats[project.localProjectId] ?? []).map((chat) => {
                const chatActive = active && selectedSessionId === chat.sessionId;
                return (<div className={`rm-project-chat-item ${chatActive ? "active" : ""}`} key={chat.sessionId}>
                    <button className="rm-project-chat-row" aria-current={chatActive ? "page" : undefined} type="button" onClick={() => selectChat(project.localProjectId, chat.sessionId)}><span>{chat.title || tr("chat.agent.none")}</span></button>
                    {renderChatMenu(chat, `project:${chat.sessionId}`)}
                  </div>);
                })}
                </div>
              </div>);
        })}
        </div>
      </section>

      {extensionNavigation.filter((item) => item.group === "workspace").map((item) => (
        <RailButton key={item.key} label={item.title} active={activeView === item.key} onClick={() => onSelectExtension(item.pluginId, item.pageId)}>
          {extensionIcon(item.icon)}
        </RailButton>
      ))}

      <div className="rm-rail-group rm-rail-capabilities">
        {extensionNavigation.filter((item) => item.group === "tools").map((item) => (
          <RailButton key={item.key} label={item.title} active={activeView === item.key} onClick={() => onSelectExtension(item.pluginId, item.pageId)}>
            {extensionIcon(item.icon)}
          </RailButton>
        ))}
        <RailButton label={tr("settings.extensions.title")} active={false} onClick={onOpenTools}>
          <Puzzle size={14}/>
        </RailButton>
      </div>
      <div className="rm-rail-spacer"/>

      <RailButton label={tr("nav.settings")} active={activeView === "settings"} onClick={() => onSelect("settings")}>
        <Settings size={14}/>
      </RailButton>

      <AccountMenu state={state} busy={authBusy} expanded={expanded} onSignIn={onSignIn} onSignOut={onSignOut} onSwitchSpace={onSwitchSpace} onUpgrade={onUpgrade} onTopUpCredits={onTopUpCredits} onOpenCreditsUsage={onOpenCreditsUsage} onOpenAccountCenter={onOpenAccountCenter}/>
      {recentSearchOpen && <RecentChatSearchDialog chats={recentChats} onClose={() => setRecentSearchOpen(false)} onSelect={(chat) => selectChat(chat.localProjectId, chat.sessionId)}/>}
      {chatDialog?.kind === "rename" && <AppDialog title={tr("chat.rename")} onClose={() => setChatDialog(null)} footer={<><button className="secondary-button" type="button" onClick={() => setChatDialog(null)}>{tr("project.cancel")}</button><button className="primary-button" type="button" disabled={!chatDialogValue.trim()} onClick={submitChatDialog}>{tr("project.save")}</button></>}>
          <label className="app-dialog-field"><span>{tr("chat.rename.label")}</span><input className="app-dialog-input" autoFocus maxLength={120} value={chatDialogValue} onChange={(event) => setChatDialogValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitChatDialog(); }}/></label>
        </AppDialog>}
      {chatDialog?.kind === "move" && <AppDialog title={tr("chat.move")} onClose={() => setChatDialog(null)} footer={<><button className="secondary-button" type="button" onClick={() => setChatDialog(null)}>{tr("project.cancel")}</button><button className="primary-button" type="button" disabled={!canMoveChat} onClick={submitChatDialog}>{tr("chat.move")}</button></>}>
          <label className="app-dialog-field"><span>{tr("chat.move.label")}</span><select className="app-dialog-select" autoFocus value={chatDialogValue} onChange={(event) => setChatDialogValue(event.target.value)}>{chatDialogChoices.map((choice) => <option key={choice.id ?? "__general__"} value={choice.id ?? "__general__"}>{choice.name}</option>)}</select></label>
        </AppDialog>}
      {chatDialog?.kind === "delete" && <AppDialog title={tr("chat.delete")} description={chatDialog.chat.title} width="small" onClose={() => setChatDialog(null)} footer={<><button className="secondary-button" type="button" onClick={() => setChatDialog(null)}>{tr("project.cancel")}</button><button className="app-dialog-danger-button" type="button" onClick={submitChatDialog}>{tr("chat.delete")}</button></>}>
          <div className="app-dialog-danger-copy">{tr("chat.delete.confirm")}</div>
        </AppDialog>}
    </nav>);
}
function extensionIcon(icon: DesktopExtensionSummary["navigation"][number]["icon"]) {
    if (icon === "video") return <Video size={14}/>;
    if (icon === "image") return <Image size={14}/>;
    if (icon === "wand-sparkles") return <WandSparkles size={14}/>;
    if (icon === "puzzle") return <Puzzle size={14}/>;
    if (icon === "box") return <BoxIcon size={14}/>;
    if (icon === "cpu") return <Cpu size={14}/>;
    return <AudioLines size={14}/>;
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
