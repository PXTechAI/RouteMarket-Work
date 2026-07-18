import { Paperclip, Sparkles } from "lucide-react";
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
        <div className="message-text">
          {message.content || (streaming ? "正在思考..." : "")}
        </div>
        {message.stopped && <span className="stopped-label">已停止</span>}
      </div>
    </article>
  );
}
