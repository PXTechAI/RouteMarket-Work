import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LocalProjectChatSummary } from "../../../shared/desktop-api";
import { tr } from "../i18n";
import "./recent-chat-search.scss";

export function RecentChatSearchDialog({ chats, onClose, onSelect }: {
    chats: LocalProjectChatSummary[];
    onClose(): void;
    onSelect(chat: LocalProjectChatSummary): void;
}) {
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const results = useMemo(() => normalizedQuery
        ? chats.filter((chat) => chat.title.toLocaleLowerCase().includes(normalizedQuery))
        : [], [chats, normalizedQuery]);

    useEffect(() => {
        inputRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return createPortal(<div className="rm-session-search-overlay" role="presentation" onMouseDown={onClose}>
      <section className="rm-session-search-dialog" role="dialog" aria-modal="true" aria-label={tr("chat.searchHistory")} onMouseDown={(event) => event.stopPropagation()}>
        <header className="rm-session-search-header">
          <label className="rm-session-search-input-wrap">
            <Search size={16}/>
            <input ref={inputRef} type="search" value={query} placeholder={tr("chat.searchHistory")} aria-label={tr("chat.searchHistory")} onChange={(event) => setQuery(event.target.value)}/>
          </label>
          <button className="rm-session-search-close" type="button" title={tr("menu.file.close")} aria-label={tr("menu.file.close")} onClick={onClose}><X size={16}/></button>
        </header>
        <div className="rm-session-search-body">
          {!normalizedQuery ? <div className="rm-session-search-hint">{tr("chat.searchHint")}</div>
            : results.length > 0 ? <div className="rm-session-search-results">{results.map((chat) => <button className="rm-session-search-result" type="button" key={`${chat.localProjectId ?? "general"}:${chat.sessionId}`} onClick={() => { onSelect(chat); onClose(); }}>
                <span className="rm-session-search-result-title">{highlightMatch(chat.title || tr("chat.agent.none"), query)}</span>
                <span className="rm-session-search-result-meta">{formatUpdatedAt(chat.updatedAt)}</span>
              </button>)}</div>
            : <div className="rm-session-search-hint">{tr("chat.searchEmpty")}</div>}
        </div>
      </section>
    </div>, document.body);
}

function highlightMatch(text: string, query: string) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return text;
    const index = text.toLocaleLowerCase().indexOf(trimmedQuery.toLocaleLowerCase());
    if (index < 0) return text;
    return <>{text.slice(0, index)}<mark>{text.slice(index, index + trimmedQuery.length)}</mark>{text.slice(index + trimmedQuery.length)}</>;
}

function formatUpdatedAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
        year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}
