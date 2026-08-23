import { tr } from "../../i18n";
import "./chat.scss";
import { Bot, ChevronDown, CircleAlert, Cloud, Folder, FolderPlus, LoaderCircle, Paperclip, Pencil, RefreshCw, Send, Square, WandSparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { DesktopAgentSkillAvailability } from "../../../../shared/agent-skill-availability";
import type { ChatModel, DesktopChatAttachment, DesktopAgentProfile, ProjectContext, ProjectSummary, ReadResult, WebSearchMode, WorkState } from "../../../../shared/desktop-api";
import { ChatMessageRow } from "./components/ChatMessageRow";
import type { ProjectSkillManagerActions } from "../project-skills/ProjectSkillsPanel";
import { AgentAvatar } from "./components/AgentAvatar";
import { ChatAgentPicker } from "./components/ChatAgentPicker";
import { ModelPicker } from "./components/ModelPicker";
import { ChatOptionPicker } from "./components/ChatOptionPicker";
import { ChatSkillsControl } from "./components/ChatSkillsControl";
import { ChatToolsMenu } from "./components/ChatToolsMenu";
import { ChatComposerAttachments } from "./components/ChatComposerAttachments";
import { supportsNativeWebSearch } from "./web-search-mode";
import { VirtualMessageList } from "./VirtualMessageList";
import type { ChatMessage } from "./types";
import { projectFolderAvailable, projectFolderMessage, projectFolderStatus } from "../projects/project-folder-status";
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
    uploadingAttachments: DesktopChatAttachment[];
    recentAttachments: DesktopChatAttachment[];
    authStatus: WorkState["authStatus"];
    models: ChatModel[];
    selectedModelCode: string;
    executionEnvironment: "auto" | "local" | "cloud";
    webSearchMode: WebSearchMode;
    deepThinkingEnabled: boolean;
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
    attachmentsBusy: boolean;
    error: string | null;
    onAttachProjectFolder(): void;
    onDraftChange(value: string): void;
    onChooseAttachments(): void;
    onUploadAttachmentFiles(files: File[]): void;
    onChooseRecentAttachment(attachment: DesktopChatAttachment): void;
    onClearAttachments(): void;
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
    onDeepThinkingChange(value: boolean): void;
    onAgentChange(agentId: string): void;
    onRefreshAgents(): void;
    onManageAgents(): void;
    onUpdateAgent(): void;
    onProjectSkillChange(value: string): void;
    onIncludeFileContextChange(value: boolean): void;
    onDismissError(): void;
    onOpenArtifact?(relativePath: string): void;
};
export function ChatPage({ selectedProject, hasConversation, messages, activeRequestId, includeFileContext, selectedFilePath, readResult, draft, attachments, uploadingAttachments, recentAttachments, authStatus, models, selectedModelCode, executionEnvironment, webSearchMode, deepThinkingEnabled, modelsLoading, agents, agentsLoading, selectedAgentId, selectedAgent, agentVersion, agentSkills, projectContext, selectedProjectSkillId, projectSkillActions, editingMessageId, attachmentsBusy, error, onAttachProjectFolder, onDraftChange, onChooseAttachments, onUploadAttachmentFiles, onChooseRecentAttachment, onClearAttachments, onRemoveAttachment, onSend, onRetry, onEditMessage, onCancelEdit, onStop, onModelChange, onManageModelProviders, onExecutionEnvironmentChange, onWebSearchModeChange, onDeepThinkingChange, onAgentChange, onRefreshAgents, onManageAgents, onUpdateAgent, onProjectSkillChange, onIncludeFileContextChange, onDismissError, onOpenArtifact }: ChatPageProps) {
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const composerInputRef = useRef<HTMLTextAreaElement>(null);
    const stickToBottomRef = useRef(true);
    const dragDepthRef = useRef(0);
    const [fileDragActive, setFileDragActive] = useState(false);
    const latestMessage = messages.at(-1);
    const selectedModel = models.find((model) => model.code === selectedModelCode) ?? null;
    const folderAvailable = projectFolderAvailable(selectedProject);
    const folderStatus = projectFolderStatus(selectedProject);
    const displayedExecutionEnvironment = executionEnvironment === "auto" && !folderAvailable
        ? "cloud"
        : executionEnvironment;
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
        if (attachmentsBusy)
            return;
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
    function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
        return Array.from(event.dataTransfer.types).includes("Files");
    }
    function handleDragEnter(event: DragEvent<HTMLDivElement>) {
        if (!hasDraggedFiles(event) || activeRequestId || attachmentsBusy)
            return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setFileDragActive(true);
    }
    function handleDragLeave(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0)
            setFileDragActive(false);
    }
    function handleDrop(event: DragEvent<HTMLDivElement>) {
        if (!hasDraggedFiles(event))
            return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setFileDragActive(false);
        if (activeRequestId || attachmentsBusy)
            return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length)
            onUploadAttachmentFiles(files);
    }
    return (<section className={`chat-pane ${messages.length === 0 ? "chat-pane-welcome" : ""}`}>
      <div ref={chatScrollRef} className="chat-scroll">
        {messages.length === 0 && (<div className="chat-empty">
            <div className="chat-welcome-head">
              <AgentAvatar className="chat-empty-agent-avatar" name={selectedAgent?.name ?? "RouteMarket Agent"} avatarUrl={selectedAgent?.avatarUrl} size={56}/>
              <h2>
                <span>{selectedAgent?.name ?? (selectedProject ? tr("chat.projectConversation") : tr("chat.general"))}</span>
                {selectedProject && (<span className="chat-project-badge" title={tr("chat.projectBadge", [selectedProject.displayName])}>
                    <Folder size={13} aria-hidden="true"/>
                    <span>{tr("chat.projectBadge", [selectedProject.displayName])}</span>
                  </span>)}
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
        {hasConversation && messages.length > 0 && (<VirtualMessageList messages={messages} scrollerRef={chatScrollRef} renderMessage={(message) => (<ChatMessageRow key={message.id} message={message} projectId={selectedProject?.localProjectId} streaming={message.id === `assistant:${activeRequestId}`} onRetry={message.role === "assistant" &&
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

      {(hasConversation || messages.length === 0) && (<div className="composer-shell" onDragEnter={handleDragEnter} onDragOver={(event) => {
          if (hasDraggedFiles(event)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
          }
      }} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          {editingMessageId && (<div className="message-edit-banner" role="status">
              <Pencil size={13}/>
              <span>{tr("chat.edit.appendNotice")}</span>
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
          <div className="composer">
            {fileDragActive ? (<div className="composer-drop-overlay" role="status">
                <Paperclip size={20}/>
                <span>{tr("chat.attachments.dropHint")}</span>
              </div>) : attachmentsBusy && !uploadingAttachments.length ? (<div className="composer-drop-overlay" role="status">
                <LoaderCircle className="spin" size={20}/>
                <span>{tr("chat.attachments.uploading")}</span>
              </div>) : null}
            <div className="composer-topbar">
                <ChatAgentPicker agents={agents} selectedAgentId={selectedAgentId} loading={agentsLoading} disabled={Boolean(activeRequestId)} onSelect={onAgentChange} onRefresh={onRefreshAgents} onManage={onManageAgents}/>
              <div className="composer-top-actions">
                <button type="button" onClick={() => onDraftChange(tr("ui.3519361a188a"))}>{tr("ui.da8f4f606abf")}</button>
                <button type="button" title={tr("ui.3aa78733475b")} disabled><WandSparkles size={13}/>{tr("ui.71b89a55a980")}</button>
              </div>
            </div>
            <textarea ref={composerInputRef} value={draft} placeholder={authStatus === "signed_in"
                ? tr("ui.80ffae84d83f") : tr("ui.435b61fdf760")} disabled={authStatus !== "signed_in"} rows={4} onChange={(event) => onDraftChange(event.target.value)} onPaste={(event) => {
                const itemFiles = Array.from(event.clipboardData.items)
                    .filter((item) => item.kind === "file")
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => Boolean(file));
                const files = event.clipboardData.files.length
                    ? Array.from(event.clipboardData.files)
                    : itemFiles;
                if (!files.length)
                    return;
                event.preventDefault();
                if (!activeRequestId && !attachmentsBusy)
                    onUploadAttachmentFiles(files);
            }} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendFromComposer();
                }
            }}/>
            <ChatComposerAttachments attachments={[...attachments, ...uploadingAttachments]} disabled={Boolean(activeRequestId) || attachmentsBusy} onRemove={onRemoveAttachment}/>
            <div className="composer-footer">
              <div className="composer-status">
                <ModelPicker models={models} value={selectedModelCode} authStatus={authStatus} loading={modelsLoading} disabled={Boolean(activeRequestId)} onChange={onModelChange} onManageProviders={onManageModelProviders}/>
                <ChatToolsMenu
                  attachments={attachments}
                  recentAttachments={recentAttachments}
                  deepThinkingEnabled={deepThinkingEnabled}
                  canUseDeepThinking={selectedModel?.supportsReasoningSummary === true}
                  webSearchMode={webSearchMode}
                  canUseWebSearch={Boolean(selectedModel?.supportsTools || supportsNativeWebSearch(selectedModel))}
                  canUseNativeWebSearch={supportsNativeWebSearch(selectedModel)}
                  disabled={Boolean(activeRequestId) || attachmentsBusy}
                  onChooseAttachments={onChooseAttachments}
                  onChooseRecentAttachment={onChooseRecentAttachment}
                  onClearAttachments={onClearAttachments}
                  onDeepThinkingChange={onDeepThinkingChange}
                  onWebSearchModeChange={onWebSearchModeChange}
                />
                <ChatSkillsControl agentSkills={agentSkills} projectSkillCount={projectContext?.skills.length ?? 0} projectSkillActions={projectSkillActions} disabled={Boolean(activeRequestId)}/>
                <ChatOptionPicker value={displayedExecutionEnvironment} label={tr("ui.059d73c84364")} icon={<Cloud size={13}/>} disabled={Boolean(activeRequestId)} options={[{ value: "auto", label: tr("ui.9741bc8c5f40") }, { value: "local", label: tr("ui.84588afc849d") }, { value: "cloud", label: tr("ui.7d0728e4127c") }]} onChange={onExecutionEnvironmentChange}/>
                {projectContext?.skills.length ? (<label className="project-skill-picker">
                    <Bot size={13}/>
                    <select aria-label={tr("ui.25715427b083")} value={selectedProjectSkillId} disabled={Boolean(activeRequestId)} onChange={(event) => onProjectSkillChange(event.target.value)}>
                      <option value="">{tr("ui.88ea94d9cd8c")}</option>
                      {projectContext.skills.map((skill) => (<option key={skill.id} value={skill.id}>{skill.name}</option>))}
                    </select>
                    <ChevronDown size={12}/>
                  </label>) : null}
                {readResult && !includeFileContext && (<button className="attach-button" type="button" onClick={() => onIncludeFileContextChange(true)}>
                    <Paperclip size={14}/>{tr("ui.ee8ddb2ec052")}</button>)}
              </div>
              {activeRequestId ? (<button className="send-button stop" type="button" title={tr("ui.76349aa64a24")} onClick={onStop}>
                  <Square size={14} fill="currentColor"/>
                </button>) : (<button className="send-button" type="button" title={tr("ui.1214d633a448")} disabled={attachmentsBusy || (!draft.trim() && !attachments.length) ||
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
