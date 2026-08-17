import { tr } from "../../../i18n";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Settings2, Sparkles } from "lucide-react";
import type { ChatModel, WorkState } from "../../../../../shared/desktop-api";

export function ModelPicker({ models, value, authStatus, loading, disabled, onChange, onManageProviders }: {
    models: ChatModel[];
    value: string;
    authStatus: WorkState["authStatus"];
    loading: boolean;
    disabled: boolean;
    onChange(value: string): void;
    onManageProviders?(): void;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = models.find((model) => model.code === value) ?? null;
    const groups = [...models.reduce((map, model) => {
        const key = model.providerId ?? "routemarket";
        const group = map.get(key) ?? { name: model.providerName, source: model.source, models: [] as ChatModel[] };
        group.models.push(model);
        map.set(key, group);
        return map;
    }, new Map<string, { name: string; source: ChatModel["source"]; models: ChatModel[] }>()).entries()];
    useEffect(() => {
        if (!open)
            return;
        const close = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node))
                setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape")
                setOpen(false);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", escape);
        };
    }, [open]);
    const unavailable = disabled || loading || models.length === 0;
    return (<div className="rm-model-picker" ref={rootRef}>
      <button className="rm-model-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} disabled={unavailable} onClick={() => setOpen((current) => !current)}>
        <Sparkles size={13}/>
        <span>{selected?.displayName ?? (authStatus === "signed_in" ? tr("ui.509039e664ff") : tr("ui.d4101b134474"))}</span>
        {loading ? <LoaderCircle className="spin" size={13}/> : <ChevronDown size={13}/>}
      </button>
      {open && (<div className="rm-model-picker-menu" role="listbox" aria-label={tr("ui.d099933a7e56")}>
          {groups.map(([key, group]) => (<div className="rm-model-picker-group" key={key}>
            <div className="rm-model-picker-group-label"><span>{group.name}</span><small>{tr(group.source === "routemarket" ? "chat.model.accountCredits" : "chat.model.ownApi")}</small></div>
            {group.models.map((model) => (<button key={model.code} type="button" role="option" aria-selected={model.code === value} className={model.code === value ? "active" : ""} onClick={() => {
                  onChange(model.code);
                  setOpen(false);
              }}>
                <span>{model.displayName}</span>
                {model.code === value ? <Check size={14}/> : null}
              </button>))}
          </div>))}
          {onManageProviders ? <div className="rm-model-picker-footer">
            <button type="button" onClick={() => { setOpen(false); onManageProviders(); }}><Settings2 size={13}/><span>{tr("chat.model.manageProviders")}</span></button>
          </div> : null}
        </div>)}
    </div>);
}
