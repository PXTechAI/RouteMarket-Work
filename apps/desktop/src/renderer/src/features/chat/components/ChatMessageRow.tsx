import {
  CheckCircle2,
  CircleAlert,
  Copy,
  LoaderCircle,
  Paperclip,
  Pencil,
  RotateCcw
} from "lucide-react";
import { useState } from "react";
import type { ChatMessage } from "../types";
import { AgentAvatar } from "./AgentAvatar";
import { MessageMarkdown } from "./MessageMarkdown";

export function ChatMessageRow({
  message,
  streaming,
  onRetry,
  onEdit
}: {
  message: ChatMessage;
  streaming: boolean;
  onRetry?: () => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isError = message.role === "assistant" && message.content.startsWith("请求失败：");
  const visibleContent = isError
    ? message.content.slice("请求失败：".length).trim()
    : message.content;

  async function copyMessage() {
    if (!message.content) return;
    await navigator.clipboard.writeText(visibleContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <article className={`chat-message ${message.role}${isError ? " error" : ""}`}>
      <div className="message-avatar">
        {message.role === "assistant" ? (
          <AgentAvatar
            name={message.agentName ?? "RouteMarket Agent"}
            avatarUrl={message.agentAvatarUrl}
            size={28}
          />
        ) : "你"}
      </div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === "assistant" ? message.agentName ?? "RouteMarket Agent" : "你"}</strong>
          <time>
            {new Date(message.sentAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit"
            })}
          </time>
        </div>
        {message.contextFile && (
          <div className="message-context">
            <Paperclip size={12} />
            {message.contextFile}
          </div>
        )}
        {message.tools?.length ? (
          <div className="message-tools" aria-label="本地工具活动">
            {message.tools.map((tool) => (
              <div className={`message-tool ${tool.status}`} key={tool.toolCallId}>
                {tool.status === "running" ? (
                  <LoaderCircle className="message-tool-spinner" size={14} />
                ) : tool.status === "completed" ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <CircleAlert size={14} />
                )}
                <span>
                  <strong>{tool.title}</strong>
                  {tool.detail ? <small>{tool.detail}</small> : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {isError ? (
          <div className="message-error-card" role="alert">
            <strong><CircleAlert size={14} />请求失败</strong>
            <p>这次对话请求未能完成。</p>
            <small>{visibleContent}</small>
          </div>
        ) : (
          <div className="message-text">
            {visibleContent ? (
              <MessageMarkdown content={visibleContent} />
            ) : streaming ? (
              <span className="message-thinking"><LoaderCircle size={14} />正在思考...</span>
            ) : null}
          </div>
        )}
        {(message.content || isError) && (message.role === "assistant" || onEdit) ? (
          <div className="message-actions">
            {onEdit ? (
              <button type="button" onClick={onEdit} title="编辑消息" aria-label="编辑消息">
                <Pencil size={14} />
              </button>
            ) : null}
            {onRetry ? (
              <button type="button" onClick={onRetry} title="重新生成" aria-label="重新生成">
                <RotateCcw size={14} />
              </button>
            ) : null}
            <button type="button" onClick={() => void copyMessage()} title="复制" aria-label="复制">
              <Copy size={14} />
              {copied ? <span>已复制</span> : null}
            </button>
          </div>
        ) : null}
        {message.stopped && <span className="stopped-label">已停止</span>}
      </div>
    </article>
  );
}
