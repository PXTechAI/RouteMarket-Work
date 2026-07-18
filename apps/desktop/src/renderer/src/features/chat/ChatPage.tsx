import {
  Bot,
  ChevronDown,
  CircleAlert,
  FolderPlus,
  Paperclip,
  Send,
  Sparkles,
  Square,
  X
} from "lucide-react";
import type {
  ChatModel,
  ProjectContext,
  ProjectSummary,
  ReadResult,
  WorkState
} from "../../../../shared/desktop-api";
import { ChatMessageRow } from "./components/ChatMessageRow";
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
  modelsLoading: boolean;
  projectContext: ProjectContext | null;
  selectedProjectSkillId: string;
  error: string | null;
  onChooseProject(): void;
  onDraftChange(value: string): void;
  onSend(): void;
  onStop(): void;
  onModelChange(value: string): void;
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
  modelsLoading,
  projectContext,
  selectedProjectSkillId,
  error,
  onChooseProject,
  onDraftChange,
  onSend,
  onStop,
  onModelChange,
  onProjectSkillChange,
  onIncludeFileContextChange,
  onDismissError
}: ChatPageProps) {
  return (
    <section className="chat-pane">
      <div className="chat-scroll">
        {!selectedProject && (
          <div className="blank-state">
            <div className="blank-icon"><FolderPlus size={28} /></div>
            <h2>打开一个本地项目开始对话</h2>
            <button className="primary-button" type="button" onClick={onChooseProject}>
              <FolderPlus size={16} />
              选择文件夹
            </button>
          </div>
        )}
        {selectedProject && messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon"><Sparkles size={25} /></div>
            <h2>和 {selectedProject.displayName} 一起工作</h2>
            <p>选择左侧文件可以把内容带入本次请求，也可以直接讨论整个项目。</p>
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
            <textarea
              value={draft}
              placeholder={
                authStatus === "signed_in"
                  ? "询问项目、分析文件或规划下一步..."
                  : "登录后开始项目对话"
              }
              disabled={authStatus !== "signed_in"}
              rows={3}
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
                {!readResult && <span>Enter 发送 · Shift Enter 换行</span>}
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
                    authStatus !== "signed_in"
                  }
                  onClick={onSend}
                >
                  <Send size={15} />
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
