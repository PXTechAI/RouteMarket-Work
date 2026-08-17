import { tr } from "../../i18n";
import { Bot, ChevronDown, CircleAlert, FolderPlus, Globe2, Paperclip, Pencil, RefreshCw, Send, Square, WandSparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { DesktopAgentSkillAvailability } from "../../../../shared/agent-skill-availability";
import type { ChatModel, DesktopChatAttachment, DesktopAgentProfile, ProjectContext, ProjectSummary, ReadResult, WebSearchMode, WorkState } from "../../../../shared/desktop-api";
import { ChatMessageRow } from "./components/ChatMessageRow";
import { AgentSkillStatusList } from "../agent/AgentSkillStatusList";
import { ProjectSkillsPanel, type ProjectSkillManagerActions } from "../project-skills/ProjectSkillsPanel";
import { AgentAvatar } from "./components/AgentAvatar";
import { ChatAgentPicker } from "./components/ChatAgentPicker";
import { ModelPicker } from "./components/ModelPicker";
import { ChatOptionPicker } from "./components/ChatOptionPicker";
import { VirtualMessageList } from "./VirtualMessageList";
import { supportsNativeWebSearch } from "./web-search-mode";
import type { ChatMessage } from "./types";
import { projectFolderAvailable, projectFolderLabel, projectFolderMessage, projectFolderStatus } from "../projects/project-folder-status";
type ChatPageProps = {
    selectedProject: ProjectSummary | null;
    hasConversation: boolean;
    messages: ChatMessage[];
    activeRequestId: string | null;
    includeFileContext: boolean;
    selectedFilePath: string | null;
    readResult: ReadResult | null;
    draft: string;
    attachments: DesktopChatAttachment[];
    authStatus: WorkState["authStatus"];
    models: ChatModel[];
    selectedModelCode: string;
    executionEnvironment: "auto" | "local" | "cloud";
    webSearchMode: WebSearchMode;
    modelsLoading: boolean;
    agents: DesktopAgentProfile[];
    agentsLoading: boolean;
    selectedAgentId: string;
    selectedAgent: DesktopAgentProfile | null;
    agentVersion: {
        activeRevision: number;
        currentRevision: number;
        updateAvailable: boolean;
    } | null;
    agentSkills: DesktopAgentSkillAvailability[];
    projectContext: ProjectContext | null;
    selectedProjectSkillId: string;
    projectSkillActions: ProjectSkillManagerActions | null;
    editingMessageId: string | null;
    error: string | null;
    onAttachProjectFolder(): void;
    onDraftChange(value: string): void;
    onChooseAttachments(): void;
    onRemoveAttachment(attachmentId: string): void;
    onSend(): void;
    onRetry(messageId: string): void;
    onEditMessage(messageId: string): void;
    onCancelEdit(): void;
    onStop(): void;
    onModelChange(value: string): void;
    onManageModelProviders(): void;
    onExecutionEnvironmentChange(value: "auto" | "local" | "cloud"): void;
    onWebSearchModeChange(value: WebSearchMode): void;
    onAgentChange(agentId: string): void;
    onUpdateAgent(): void;
    onProjectSkillChange(value: string): void;
    onIncludeFileContextChange(value: boolean): void;
    onDismissError(): void;
    onOpenArtifact?(relativePath: string): void;
};
export function ChatPage({ selectedProject, hasConversation, messages, activeRequestId, includeFileContext, selectedFilePath, readResult, draft, attachments, authStatus, models, selectedModelCode, executionEnvironment, webSearchMode, modelsLoading, agents, agentsLoading, selectedAgentId, selectedAgent, agentVersion, agentSkills, projectContext, selectedProjectSkillId, projectSkillActions, editingMessageId, error, onAttachProjectFolder, onDraftChange, onChooseAttachments, onRemoveAttachment, onSend, onRetry, onEditMessage, onCancelEdit, onStop, onModelChange, onManageModelProviders, onExecutionEnvironmentChange, onWebSearchModeChange, onAgentChange, onUpdateAgent, onProjectSkillChange, onIncludeFileContextChange, onDismissError, onOpenArtifact }: ChatPageProps) {
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const composerInputRef = useRef<HTMLTextAreaElement>(null);
    const stickToBottomRef = useRef(true);
    const latestMessage = messages.at(-1);
    const folderAvailable = projectFolderAvailable(selectedProject);
    const folderStatus = projectFolderStatus(selectedProject);
    const selectedModel = models.find((model) => model.code === selectedModelCode) ?? null;
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
    }, [selectedProject?.localProjectId]);
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
        messages.length,
        latestMessage?.content,
        latestMessage?.tools?.length,
        latestMessage?.tools?.at(-1)?.status,
        latestMessage?.artifacts?.length,
        activeRequestId
    ]);
    useEffect(() => {
        if (!editingMessageId)
            return;
        composerInputRef.current?.focus();
        composerInputRef.current?.setSelectionRange(composerInputRef.current.value.length, composerInputRef.current.value.length);
    }, [editingMessageId]);
    function sendFromComposer() {
        stickToBottomRef.current = true;
        onSend();
    }
    function chooseStarter(question: string) {
        onDraftChange(question);
        window.requestAnimationFrame(() => {
            composerInputRef.current?.focus();
            composerInputRef.current?.setSelectionRange(question.length, question.length);
        });
    }
    return (<section className={`chat-pane ${messages.length === 0 ? "chat-pane-welcome" : ""}`}>
      <div ref={chatScrollRef} className="chat-scroll">
        {messages.length === 0 && (<div className="chat-empty">
            <div className="chat-welcome-head">
              <AgentAvatar className="chat-empty-agent-avatar" name={selectedAgent?.name ?? "RouteMarket Agent"} avatarUrl={selectedAgent?.avatarUrl} size={56}/>
              <h2>
              {selectedAgent
                ? selectedProject ? `${selectedAgent.name} · ${selectedProject.displayName}` : selectedAgent.name
                : selectedProject ? tr("ui.49a9a0e11212", [selectedProject.displayName]) : tr("chat.general")}
              </h2>
            </div>
            {selectedAgent?.greeting ? <p className="chat-welcome-greeting">{selectedAgent.greeting}</p>
              : !selectedProject ? <p className="chat-welcome-greeting">{tr("chat.generalDescription")}</p>
              : folderAvailable ? <p className="chat-welcome-greeting">{tr("ui.4760229c70f0")}</p> : null}
            {selectedProject && !folderAvailable ? (<div className="chat-folder-callout">
                <p>
                  {folderStatus === "unlinked"
                    ? tr("ui.f76b72204737") : projectFolderMessage(selectedProject)}
                </p>
                <button className="chat-link-folder" type="button" onClick={onAttachProjectFolder}>
                  <FolderPlus size={15}/>
                  {folderStatus === "unlinked" ? tr("ui.fd48bc5b93ea") : tr("ui.4cf9e92ce2e9")}
                </button>
              </div>) : null}
            {selectedAgent?.starterQuestions.length ? (<div className="chat-starter-list">
                <div className="chat-starter-label">{tr("chat.tryAsking")}</div>
                <div className="chat-starter-grid">
                  {selectedAgent.starterQuestions.slice(0, 4).map((question) => (<button type="button" key={question} onClick={() => chooseStarter(question)}>
                      {question}
                    </button>))}
                </div>
              </div>) : null}
          </div>)}
        {hasConversation && messages.length > 0 && (<VirtualMessageList messages={messages} scrollerRef={chatScrollRef} renderMessage={(message) => (<ChatMessageRow key={message.id} message={message} streaming={message.id === `assistant:${activeRequestId}`} onRetry={message.role === "assistant" &&
                    !activeRequestId &&
                    !editingMessageId
                    ? () => {
                        stickToBottomRef.current = true;
                        onRetry(message.id);
                    }
                    : undefined} onEdit={message.role === "user" && !activeRequestId
                    ? () => onEditMessage(message.id)
                    : undefined} onOpenArtifact={(relativePath) => onOpenArtifact?.(relativePath) ?? window.dispatchEvent(new CustomEvent("routemarket:open-chat-artifact", { detail: relativePath }))}/>)}/>)}
      </div>

      {(hasConversation || messages.length === 0) && (<div className="composer-shell">
          {editingMessageId && (<div className="message-edit-banner" role="status">
              <Pencil size={13}/>
              <span>{tr("ui.452f5a43543c")}</span>
              <button type="button" onClick={onCancelEdit}>
                <X size={12}/>{tr("ui.4d0b4688c787")}</button>
            </div>)}
          {agentVersion?.updateAvailable && (<div className="agent-version-banner" role="status">
              <div>
                <strong>{tr("ui.e5aa242723ba")}</strong>
                <span>{tr("ui.161eb5a17eaf")}{agentVersion.activeRevision}{tr("ui.f3a0cd7310ca")}{" "}
                  v{agentVersion.currentRevision}{tr("ui.69d6cf851e8e")}</span>
              </div>
              <button type="button" disabled={Boolean(activeRequestId)} onClick={onUpdateAgent}>
                <RefreshCw size={13}/>{tr("ui.322d04779778")}</button>
            </div>)}
          {includeFileContext && selectedFilePath && readResult && (<div className="context-chip">
              <Paperclip size={13}/>
              <span>{selectedFilePath}</span>
              <button type="button" title={tr("ui.5c2b2177fd5a")} onClick={() => onIncludeFileContextChange(false)}>
                <X size={13}/>
              </button>
            </div>)}
          {attachments.length ? (<div className="composer-attachments" aria-label={tr("ui.fd8f8ccc9b7f")}>
              {attachments.map((attachment) => (<div className="context-chip" key={attachment.id}>
                  <Paperclip size={13}/>
                  <span>{attachment.name}</span>
                  <small>{formatAttachmentSize(attachment.size)}</small>
                  <button type="button" title={tr("ui.6f67cadb4d3a", [attachment.name])} onClick={() => onRemoveAttachment(attachment.id)}>
                    <X size={13}/>
                  </button>
                </div>))}
            </div>) : null}
          <div className="composer">
            <div className="composer-topbar">
                <ChatAgentPicker agents={agents} selectedAgentId={selectedAgentId} loading={agentsLoading} disabled={Boolean(activeRequestId)} onSelect={onAgentChange}/>
              <div className="composer-top-actions">
                <button type="button" onClick={() => onDraftChange(tr("ui.3519361a188a"))}>{tr("ui.da8f4f606abf")}</button>
                <button type="button" title={tr("ui.3aa78733475b")} disabled><WandSparkles size={13}/>{tr("ui.71b89a55a980")}</button>
              </div>
            </div>
            <textarea ref={composerInputRef} value={draft} placeholder={authStatus === "signed_in"
                ? tr("ui.80ffae84d83f") : tr("ui.435b61fdf760")} disabled={authStatus !== "signed_in"} rows={4} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendFromComposer();
                }
            }}/>
            <div className="composer-footer">
              <div className="composer-status">
                <ModelPicker models={models} value={selectedModelCode} authStatus={authStatus} loading={modelsLoading} disabled={Boolean(activeRequestId)} onChange={onModelChange} onManageProviders={onManageModelProviders}/>
                <ChatOptionPicker value={executionEnvironment} label={tr("ui.059d73c84364")} disabled={Boolean(activeRequestId)} options={[{ value: "auto", label: tr("ui.9741bc8c5f40") }, { value: "local", label: tr("ui.84588afc849d") }, { value: "cloud", label: tr("ui.7d0728e4127c") }]} onChange={onExecutionEnvironmentChange}/>
                <ChatOptionPicker value={webSearchMode} label={tr("ui.45e62e474f4a")} icon={<Globe2 size={13}/>} disabled={Boolean(activeRequestId)} options={[{ value: "agentic", label: tr("ui.76a7ece8c119"), disabled: selectedModel?.supportsTools === false }, { value: "native", label: tr("ui.2dae8bcce889"), disabled: !supportsNativeWebSearch(selectedModel) }, { value: "off", label: tr("ui.e26b52ae3c9d") }]} onChange={onWebSearchModeChange}/>
                {projectContext?.skills.length ? (<label className="project-skill-picker">
                    <Bot size={13}/>
                    <select aria-label={tr("ui.25715427b083")} value={selectedProjectSkillId} disabled={Boolean(activeRequestId)} onChange={(event) => onProjectSkillChange(event.target.value)}>
                      <option value="">{tr("ui.88ea94d9cd8c")}</option>
                      {projectContext.skills.map((skill) => (<option key={skill.id} value={skill.id}>{skill.name}</option>))}
                    </select>
                    <ChevronDown size={12}/>
                  </label>) : null}
                <ProjectSkillsPanel actions={projectSkillActions}/>
                <AgentSkillStatusList items={agentSkills} compact/>
                {selectedAgent?.toolPermissions.length ? (<span className="composer-location">{tr("ui.407b3b23a2fb")}{selectedAgent.toolPermissions.length}
                  </span>) : null}
                {readResult && !includeFileContext && (<button className="attach-button" type="button" onClick={() => onIncludeFileContextChange(true)}>
                    <Paperclip size={14}/>{tr("ui.ee8ddb2ec052")}</button>)}
                <button className="attach-button" type="button" title={tr("ui.4adbab6ffd83")} disabled={Boolean(activeRequestId) || attachments.length >= 5} onClick={onChooseAttachments}>
                  <Paperclip size={14}/>{tr("ui.dba9e8228bf3")}{attachments.length ? ` · ${attachments.length}/5` : ""}
                </button>
                <span className="composer-location">
                  {selectedProject
                    ? folderAvailable ? tr("ui.6954e2e3586c") : tr("ui.89f45fc4ecad", [projectFolderLabel(selectedProject)])
                    : tr("chat.generalLocation")}
                </span>
              </div>
              {activeRequestId ? (<button className="send-button stop" type="button" title={tr("ui.76349aa64a24")} onClick={onStop}>
                  <Square size={14} fill="currentColor"/>
                </button>) : (<button className="send-button" type="button" title={tr("ui.1214d633a448")} disabled={(!draft.trim() && !attachments.length) ||
                    !selectedModelCode ||
                    authStatus !== "signed_in"} onClick={sendFromComposer}>
                  <Send size={14}/>
                  <span>{tr("ui.1214d633a448")}</span>
                </button>)}
            </div>
          </div>
        </div>)}

      {error && (<div className="error-banner" role="alert">
          <CircleAlert size={18}/>
          <span>{error}</span>
          <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={onDismissError}>
            <X size={14}/>
          </button>
        </div>)}
    </section>);
}
function formatAttachmentSize(bytes: number): string {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
