import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Paperclip,
  Sparkles
} from "lucide-react";
import type { ChatMessage } from "../types";

export function ChatMessageRow({
  message,
  streaming
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  return (
    <article className={`chat-message ${message.role}`}>
      <div className="message-avatar">
        {message.role === "assistant" ? <Sparkles size={15} /> : "你"}
      </div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === "assistant" ? "RouteMarket Work" : "你"}</strong>
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
        <div className="message-text">
          {message.content || (streaming ? "正在思考..." : "")}
        </div>
        {message.stopped && <span className="stopped-label">已停止</span>}
      </div>
    </article>
  );
}
