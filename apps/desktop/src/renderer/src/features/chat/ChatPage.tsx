import {
  Bot,
  ChevronDown,
  CircleAlert,
  FolderPlus,
  Paperclip,
  Send,
  Square,
  WandSparkles,
  X
} from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  ChatModel,
  DesktopAgentProfile,
  ProjectContext,
  ProjectSummary,
  ReadResult,
  WorkState
} from "../../../../shared/desktop-api";
import { ChatMessageRow } from "./components/ChatMessageRow";
import { AgentAvatar } from "./components/AgentAvatar";
import { ChatAgentPicker } from "./components/ChatAgentPicker";
import { ModelPicker } from "./components/ModelPicker";
import type { ChatMessage } from "./types";

type ChatPageProps = {
  selectedProject: ProjectSummary | null;
  messages: ChatMessage[];
  activeRequestId: string | null;
  includeFileContext: boolean;
  selectedFilePath: string | null;
  readResult: ReadResult | null;
  draft: string;
  authStatus: WorkState["authStatus"];
  models: ChatModel[];
  selectedModelCode: string;
  executionEnvironment: "auto" | "local" | "cloud";
  modelsLoading: boolean;
  agents: DesktopAgentProfile[];
  agentsLoading: boolean;
  selectedAgentId: string;
  selectedAgent: DesktopAgentProfile | null;
  projectContext: ProjectContext | null;
  selectedProjectSkillId: string;
  error: string | null;
  onChooseProject(): void;
  onAttachProjectFolder(): void;
  onDraftChange(value: string): void;
  onSend(): void;
  onRetry(messageId: string): void;
  onStop(): void;
  onModelChange(value: string): void;
  onExecutionEnvironmentChange(value: "auto" | "local" | "cloud"): void;
  onAgentChange(agentId: string): void;
  onProjectSkillChange(value: string): void;
  onIncludeFileContextChange(value: boolean): void;
  onDismissError(): void;
};

export function ChatPage({
  selectedProject,
  messages,
  activeRequestId,
  includeFileContext,
  selectedFilePath,
  readResult,
  draft,
  authStatus,
  models,
  selectedModelCode,
  executionEnvironment,
  modelsLoading,
  agents,
  agentsLoading,
  selectedAgentId,
  selectedAgent,
  projectContext,
  selectedProjectSkillId,
  error,
  onChooseProject,
  onAttachProjectFolder,
  onDraftChange,
  onSend,
  onRetry,
  onStop,
  onModelChange,
  onExecutionEnvironmentChange,
  onAgentChange,
  onProjectSkillChange,
  onIncludeFileContextChange,
  onDismissError
}: ChatPageProps) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const latestMessage = messages.at(-1);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    const frame = window.requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    messages.length,
    latestMessage?.content,
    latestMessage?.tools?.length,
    latestMessage?.tools?.at(-1)?.status,
    activeRequestId
  ]);

  return (
    <section className="chat-pane">
      <div ref={chatScrollRef} className="chat-scroll">
        {!selectedProject && (
          <div className="blank-state">
            <div className="blank-icon"><FolderPlus size={28} /></div>
            <h2>创建一个项目开始对话</h2>
            <button className="primary-button" type="button" onClick={onChooseProject}>
              <FolderPlus size={16} />
              创建项目
            </button>
          </div>
        )}
        {selectedProject && messages.length === 0 && (
          <div className="chat-empty">
            <AgentAvatar
              className="chat-empty-agent-avatar"
              name={selectedAgent?.name ?? "RouteMarket Agent"}
              avatarUrl={selectedAgent?.avatarUrl}
              size={48}
            />
            <h2>
              {selectedAgent
                ? `${selectedAgent.name} · ${selectedProject.displayName}`
                : `和 ${selectedProject.displayName} 一起工作`}
            </h2>
            {selectedAgent?.greeting ? <p>{selectedAgent.greeting}</p> : null}
            {selectedProject.hasFolder === false ? (
              <>
                <p>这个项目尚未关联文件夹，可以直接对话，也可以关联文件夹让 AI 读取和操作其中的内容。</p>
                <button className="chat-link-folder" type="button" onClick={onAttachProjectFolder}>
                  <FolderPlus size={15} />关联本机文件夹
                </button>
              </>
            ) : (
              <p>选择项目文件可以把内容带入本次请求，也可以直接讨论整个项目。</p>
            )}
            {selectedAgent?.starterQuestions.length ? (
              <div className="chat-starter-list">
                {selectedAgent.starterQuestions.slice(0, 3).map((question) => (
                  <button type="button" key={question} onClick={() => onDraftChange(question)}>
                    {question}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {selectedProject && messages.length > 0 && (
          <div className="message-list">
            {messages.map((message) => (
              <ChatMessageRow
                key={message.id}
                message={message}
                streaming={
                  message.id === `assistant:${activeRequestId}` &&
                  !message.content
                }
                onRetry={
                  message.role === "assistant" && !activeRequestId
                    ? () => onRetry(message.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {selectedProject && (
        <div className="composer-shell">
          {includeFileContext && selectedFilePath && readResult && (
            <div className="context-chip">
              <Paperclip size={13} />
              <span>{selectedFilePath}</span>
              <button
                type="button"
                title="移除文件上下文"
                onClick={() => onIncludeFileContextChange(false)}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className="composer">
            <div className="composer-topbar">
              <ChatAgentPicker
                agents={agents}
                selectedAgentId={selectedAgentId}
                loading={agentsLoading}
                disabled={Boolean(activeRequestId)}
                onSelect={onAgentChange}
              />
              <div className="composer-top-actions">
                <button type="button" onClick={() => onDraftChange("请分析这个项目的现状，并给出清晰的下一步行动建议。")}>常用提示词</button>
                <button type="button" title="桌面端提示词优化即将接入" disabled><WandSparkles size={13} />提示词优化</button>
              </div>
            </div>
            <textarea
              value={draft}
              placeholder={
                authStatus === "signed_in"
                  ? "输入你的问题、任务、创意、代码需求或结构化指令…"
                  : "登录后开始项目对话"
              }
              disabled={authStatus !== "signed_in"}
              rows={4}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <div className="composer-footer">
              <div className="composer-status">
                <ModelPicker
                  models={models}
                  value={selectedModelCode}
                  authStatus={authStatus}
                  loading={modelsLoading}
                  disabled={Boolean(activeRequestId)}
                  onChange={onModelChange}
                />
                <label className="project-skill-picker">
                  <select
                    aria-label="执行环境"
                    value={executionEnvironment}
                    disabled={Boolean(activeRequestId)}
                    onChange={(event) => onExecutionEnvironmentChange(
                      event.target.value as "auto" | "local" | "cloud"
                    )}
                  >
                    <option value="auto">自动选择</option>
                    <option value="local">本地执行</option>
                    <option value="cloud">云端执行</option>
                  </select>
                  <ChevronDown size={12} />
                </label>
                {projectContext?.skills.length ? (
                  <label className="project-skill-picker">
                    <Bot size={13} />
                    <select
                      aria-label="项目 Skill"
                      value={selectedProjectSkillId}
                      disabled={Boolean(activeRequestId)}
                      onChange={(event) => onProjectSkillChange(event.target.value)}
                    >
                      <option value="">不使用 Skill</option>
                      {projectContext.skills.map((skill) => (
                        <option key={skill.id} value={skill.id}>{skill.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                ) : null}
                {selectedAgent?.skills.filter((skill) => skill.enabled).length ? (
                  <span className="composer-location">
                    Agent Skills · {selectedAgent.skills.filter((skill) => skill.enabled).length}
                  </span>
                ) : null}
                {selectedAgent?.toolPermissions.length ? (
                  <span className="composer-location">
                    工具权限 · {selectedAgent.toolPermissions.length}
                  </span>
                ) : null}
                {readResult && !includeFileContext && (
                  <button
                    className="attach-button"
                    type="button"
                    onClick={() => onIncludeFileContextChange(true)}
                  >
                    <Paperclip size={14} />
                    引用当前文件
                  </button>
                )}
                <span className="composer-location">{selectedProject.hasFolder === false ? "仅本地对话" : "本机文件夹"}</span>
              </div>
              {activeRequestId ? (
                <button
                  className="send-button stop"
                  type="button"
                  title="停止生成"
                  onClick={onStop}
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="button"
                  title="发送"
                  disabled={
                    !draft.trim() ||
                    !selectedModelCode ||
                    !selectedAgent ||
                    authStatus !== "signed_in"
                  }
                  onClick={onSend}
                >
                  <Send size={14} />
                  <span>发送</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button type="button" title="关闭" onClick={onDismissError}>
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
