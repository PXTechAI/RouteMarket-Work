import { getActiveLocale, tr } from "../../../i18n";
import { CheckCircle2, ChevronDown, CircleAlert, Copy, ExternalLink, File, FileImage, FileSpreadsheet, FileText, LoaderCircle, Paperclip, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { ChatMessage } from "../types";
import { AgentAvatar } from "./AgentAvatar";
import { MessageMarkdown } from "./MessageMarkdown";
export function ChatMessageRow({ message, streaming, onRetry, onEdit, onOpenArtifact }: {
    message: ChatMessage;
    streaming: boolean;
    onRetry?: () => void;
    onEdit?: () => void;
    onOpenArtifact?: (relativePath: string) => void;
}) {
    const [copied, setCopied] = useState(false);
    const [toolsExpanded, setToolsExpanded] = useState(false);
    const isError = message.role === "assistant" && message.content.startsWith(tr("ui.2b50c241e9ab"));
    const visibleContent = isError
        ? message.content.slice(tr("ui.2b50c241e9ab").length).trim()
        : message.content;
    const runningTools = message.tools?.filter((tool) => tool.status === "running").length ?? 0;
    const failedTools = message.tools?.filter((tool) => tool.status === "error").length ?? 0;
    const showToolDetails = streaming || runningTools > 0 || failedTools > 0 || toolsExpanded;
    async function copyMessage() {
        if (!message.content)
            return;
        await navigator.clipboard.writeText(visibleContent);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    }
    return (<article className={`chat-message ${message.role}${isError ? " error" : ""}`}>
      <div className="message-avatar">
        {message.role === "assistant" ? (<AgentAvatar name={message.agentName ?? "RouteMarket Agent"} avatarUrl={message.agentAvatarUrl} size={28}/>) : tr("ui.5630b886f9cd")}
      </div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === "assistant" ? message.agentName ?? "RouteMarket Agent" : tr("ui.5630b886f9cd")}</strong>
          <time>
            {new Date(message.sentAt).toLocaleTimeString(getActiveLocale(), {
            hour: "2-digit",
            minute: "2-digit"
        })}
          </time>
        </div>
        {message.contextFile && (<div className="message-context">
            <Paperclip size={12}/>
            {message.contextFile}
          </div>)}
        {message.attachments?.length ? (<div className="message-attachments" aria-label={tr("ui.f0e5c64959a4")}>
            {message.attachments.map((attachment) => (<span className="message-context" key={attachment.id}>
                <Paperclip size={12}/>
                {attachment.name}
              </span>))}
          </div>) : null}
        {message.tools?.length ? (<div className={`message-tools${showToolDetails ? " expanded" : ""}`} aria-label={tr("ui.2fa20bda48ac")}>
            <button className="message-tools-summary" type="button" aria-expanded={showToolDetails} onClick={() => setToolsExpanded((current) => !current)}>
              {runningTools ? <LoaderCircle className="message-tool-spinner" size={14}/> : failedTools ? <CircleAlert size={14}/> : <CheckCircle2 size={14}/>}
              <span>{tr(runningTools ? "chat.tools.running" : failedTools ? "chat.tools.failed" : "chat.tools.completed", [message.tools.length])}</span>
              <ChevronDown size={14}/>
            </button>
            {showToolDetails ? (<div className="message-tool-list">
            {message.tools.map((tool) => (<div className={`message-tool ${tool.status}`} key={tool.toolCallId}>
                {tool.status === "running" ? (<LoaderCircle className="message-tool-spinner" size={14}/>) : tool.status === "completed" ? (<CheckCircle2 size={14}/>) : (<CircleAlert size={14}/>)}
                <span>
                  <strong>{tool.title}</strong>
                  {tool.detail ? <small>{tool.detail}</small> : null}
                </span>
              </div>))}
            </div>) : null}
          </div>) : null}
        {message.reasoning ? (<details className="message-reasoning" open={streaming}>
            <summary>
              {streaming ? <LoaderCircle className="message-tool-spinner" size={14}/> : <CheckCircle2 size={14}/>}
              <span>{tr(streaming ? "ui.15b51f2fd5ed" : "chat.reasoning.summary")}</span>
              <ChevronDown size={14}/>
            </summary>
            <div className="message-reasoning-content">
              <MessageMarkdown content={message.reasoning}/>
            </div>
          </details>) : null}
        {message.artifacts?.length ? (<div className="message-artifacts" aria-label={tr("chat.artifact.generatedFiles")}>
            {message.artifacts.map((artifact) => (<button className="message-artifact" type="button" key={artifact.id} onClick={() => onOpenArtifact?.(artifact.relativePath)}>
                <span className={`message-artifact-icon ${artifactKind(artifact.mimeType, artifact.filename)}`}><ArtifactIcon mimeType={artifact.mimeType} filename={artifact.filename}/></span>
                <span className="message-artifact-copy">
                  <strong>{artifact.filename}</strong>
                  <small>{artifactLabel(artifact.mimeType, artifact.filename)} · {formatFileSize(artifact.size)}</small>
                </span>
                <ExternalLink size={15}/>
              </button>))}
          </div>) : null}
        {isError ? (<div className="message-error-card" role="alert">
            <strong><CircleAlert size={14}/>{tr("ui.8fdc4112a445")}</strong>
            <p>{tr("ui.3ab152ac7010")}</p>
            <small>{visibleContent}</small>
          </div>) : (<div className="message-text">
            {visibleContent ? (<MessageMarkdown content={visibleContent}/>) : streaming && !message.reasoning ? (<span className="message-thinking"><LoaderCircle size={14}/>{tr("ui.15b51f2fd5ed")}</span>) : null}
          </div>)}
        {(message.content || message.attachments?.length || isError) &&
            (message.role === "assistant" || onEdit) ? (<div className="message-actions">
            {onEdit ? (<button type="button" onClick={onEdit} title={tr("ui.8a8de18c8f5e")} aria-label={tr("ui.8a8de18c8f5e")}>
                <Pencil size={14}/>
              </button>) : null}
            {onRetry ? (<button type="button" onClick={onRetry} title={tr("ui.2e19057052a3")} aria-label={tr("ui.2e19057052a3")}>
                <RotateCcw size={14}/>
              </button>) : null}
            <button type="button" onClick={() => void copyMessage()} title={tr("ui.4edd1d00875d")} aria-label={tr("ui.4edd1d00875d")}>
              <Copy size={14}/>
              {copied ? <span>{tr("ui.e381a5763d5f")}</span> : null}
            </button>
          </div>) : null}
        {message.stopped && <span className="stopped-label">{tr("ui.75dddf524e4c")}</span>}
        {message.failed && <span className="stopped-label failed"><CircleAlert size={12}/>{tr("chat.response.failed")}</span>}
      </div>
    </article>);
}

function ArtifactIcon({ mimeType, filename }: { mimeType: string; filename: string }) {
    const kind = artifactKind(mimeType, filename);
    if (kind === "spreadsheet") return <FileSpreadsheet size={20}/>;
    if (kind === "pdf" || kind === "text") return <FileText size={20}/>;
    if (kind === "image") return <FileImage size={20}/>;
    return <File size={20}/>;
}

function artifactKind(mimeType: string, filename: string): "spreadsheet" | "pdf" | "image" | "text" | "file" {
    const extension = filename.split(".").at(-1)?.toLocaleLowerCase();
    if (mimeType.includes("spreadsheet") || ["xlsx", "xls", "csv", "tsv"].includes(extension ?? "")) return "spreadsheet";
    if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("text/") || ["md", "txt", "json"].includes(extension ?? "")) return "text";
    return "file";
}

function artifactLabel(mimeType: string, filename: string): string {
    const kind = artifactKind(mimeType, filename);
    if (kind === "spreadsheet") return tr("chat.artifact.excelWorkbook");
    if (kind === "pdf") return tr("chat.artifact.pdfDocument");
    if (kind === "image") return tr("chat.artifact.imageFile");
    return tr("chat.artifact.generatedFile");
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
