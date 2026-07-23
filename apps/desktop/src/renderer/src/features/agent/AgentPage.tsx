import {
  Bot,
  CircleAlert,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Wrench,
  X
} from "lucide-react";
import type { AgentLocalToolGroup } from "../../../../shared/desktop-api";
import { ChatMessageRow } from "../chat/components/ChatMessageRow";
import { ModelPicker } from "../chat/components/ModelPicker";
import type { AgentPageActions, AgentPageModel } from "./types";

const LOCAL_TOOL_GROUPS: Array<{
  id: AgentLocalToolGroup;
  label: string;
}> = [
  { id: "files", label: "项目文件" },
  { id: "processes", label: "本地进程" },
  { id: "browser", label: "内置浏览器" },
  { id: "mcp", label: "Local MCP" },
  { id: "skills", label: "项目 Skill" }
];

export function AgentPage({
  model,
  actions
}: {
  model: AgentPageModel;
  actions: AgentPageActions;
}) {
  if (!model.selectedProject) {
    return (
      <section className="agent-pane agent-blank">
        <FolderPlus size={30} />
        <h2>选择项目后使用 Agent</h2>
        <button className="primary-button" type="button" onClick={actions.onChooseProject}>
          <FolderPlus size={15} />
          选择文件夹
        </button>
      </section>
    );
  }

  return (
    <section className="agent-pane">
      <aside className="agent-list">
        <div className="agent-list-header">
          <div>
            <strong>Agent</strong>
            <span>{model.agents.length} 个配置</span>
          </div>
          <button
            className="icon-button compact"
            type="button"
            title="刷新 Agent"
            disabled={model.agentsLoading || model.authStatus !== "signed_in"}
            onClick={actions.onRefreshAgents}
          >
            <RefreshCw className={model.agentsLoading ? "spin" : ""} size={14} />
          </button>
        </div>

        {model.authStatus !== "signed_in" ? (
          <div className="agent-list-empty">登录后加载主站 Agent 配置。</div>
        ) : model.agentsLoading && model.agents.length === 0 ? (
          <div className="agent-list-empty">
            <LoaderCircle className="spin" size={18} />
            正在加载 Agent
          </div>
        ) : model.agents.length === 0 ? (
          <div className="agent-list-empty">主站还没有可用的 Agent。</div>
        ) : (
          <div className="agent-list-items">
            {model.agents.map((agent) => (
              <button
                key={agent.id}
                className={agent.id === model.selectedAgentId ? "active" : ""}
                type="button"
                disabled={Boolean(model.activeRequestId)}
                onClick={() => actions.onSelectAgent(agent.id)}
              >
                <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.description || "自定义 RouteMarket Agent"}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="agent-workspace">
        {model.selectedAgent ? (
          <>
            <header className="agent-profile-header">
              <AgentAvatar
                name={model.selectedAgent.name}
                avatarUrl={model.selectedAgent.avatarUrl}
                large
              />
              <div className="agent-profile-copy">
                <h2>{model.selectedAgent.name}</h2>
                <p>{model.selectedAgent.description || "在当前项目中使用此 Agent。"}</p>
                <div className="agent-profile-meta">
                  <span><Wrench size={12} />{model.selectedAgent.tools.length} 个云端工具配置</span>
                  <span><ShieldCheck size={12} />本地操作经过审批</span>
                </div>
              </div>
              <ModelPicker
                models={model.models}
                value={model.selectedModelCode}
                authStatus={model.authStatus}
                loading={model.modelsLoading}
                disabled={Boolean(model.activeRequestId)}
                onChange={actions.onModelChange}
              />
            </header>

            <div className="agent-policy-bar">
              <div className="agent-tool-policy">
                <span>本地能力</span>
                {LOCAL_TOOL_GROUPS.map((group) => (
                  <label key={group.id}>
                    <input
                      type="checkbox"
                      checked={model.localToolGroups.includes(group.id)}
                      disabled={Boolean(model.activeRequestId)}
                      onChange={(event) =>
                        actions.onToolGroupChange(group.id, event.target.checked)}
                    />
                    {group.label}
                  </label>
                ))}
              </div>
              <label className="agent-round-limit">
                最大轮次
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={model.maxToolRounds}
                  disabled={Boolean(model.activeRequestId)}
                  onChange={(event) =>
                    actions.onMaxToolRoundsChange(Number(event.target.value))}
                />
              </label>
            </div>

            <div className="agent-chat-scroll">
              {model.messages.length ? (
                <div className="message-list">
                  {model.messages.map((message) => (
                    <ChatMessageRow
                      key={message.id}
                      message={message}
                      streaming={
                        message.id === `assistant:${model.activeRequestId}` &&
                        !message.content
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="agent-start">
                  <Bot size={27} />
                  <h3>{model.selectedAgent.greeting || `让 ${model.selectedAgent.name} 开始处理项目任务`}</h3>
                  {model.selectedAgent.starterQuestions.length > 0 && (
                    <div className="agent-starters">
                      {model.selectedAgent.starterQuestions.slice(0, 4).map((question) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => actions.onUseStarterQuestion(question)}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="agent-composer-shell">
              <div className="composer">
                <textarea
                  value={model.draft}
                  rows={3}
                  disabled={model.authStatus !== "signed_in"}
                  placeholder={`给 ${model.selectedAgent.name} 一个目标...`}
                  onChange={(event) => actions.onDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      actions.onSend();
                    }
                  }}
                />
                <div className="composer-footer">
                  <span className="agent-composer-note">
                    Agent 只能调用上方允许的本地能力，敏感操作仍需审批
                  </span>
                  {model.activeRequestId ? (
                    <button
                      className="send-button stop"
                      type="button"
                      title="停止 Agent"
                      onClick={actions.onStop}
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      type="button"
                      title="运行 Agent"
                      disabled={
                        !model.draft.trim() ||
                        !model.selectedModelCode ||
                        model.authStatus !== "signed_in"
                      }
                      onClick={actions.onSend}
                    >
                      <Send size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="agent-workspace-empty">
            <Bot size={30} />
            <h2>选择一个 Agent</h2>
            <p>Agent 配置来自 RouteMarket 主站，本地能力和审批策略由 Work 控制。</p>
          </div>
        )}
      </div>

      {model.error && (
        <div className="error-banner" role="alert">
          <CircleAlert size={18} />
          <span>{model.error}</span>
          <button type="button" title="关闭" onClick={actions.onDismissError}>
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

function AgentAvatar({
  name,
  avatarUrl,
  large = false
}: {
  name: string;
  avatarUrl: string | null;
  large?: boolean;
}) {
  return (
    <span className={`agent-avatar ${large ? "large" : ""}`} aria-hidden="true">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        name.trim().slice(0, 1).toLocaleUpperCase() || "A"
      )}
    </span>
  );
}
