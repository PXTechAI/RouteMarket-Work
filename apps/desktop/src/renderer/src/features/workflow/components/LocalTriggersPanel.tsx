import { tr } from "../../../i18n";
import { Activity, Check, LoaderCircle, Play, Square, Trash2 } from "lucide-react";
import type { LocalTriggerKind, LocalTriggerSummary } from "../../../../../shared/desktop-api";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
export function LocalTriggersPanel({ model, actions }: {
    model: Pick<WorkflowPageModel, "selectedProjectId" | "triggers" | "triggerName" | "triggerKind" | "triggerValue" | "triggerBusy">;
    actions: WorkflowPageActions["triggers"];
}) {
    return (<div className="local-trigger-layout">
      <form className="local-trigger-form" onSubmit={(event) => {
            event.preventDefault();
            actions.onCreate();
        }}>
        <h3>{tr("ui.098163201142")}</h3>
        <label>{tr("ui.1be7ae4fc257")}<input value={model.triggerName} placeholder={tr("ui.c2b0bef6c59f")} onChange={(event) => actions.onNameChange(event.target.value)}/>
        </label>
        <label>{tr("ui.e4e46c7235d1")}<select value={model.triggerKind} onChange={(event) => actions.onKindChange(event.target.value as LocalTriggerKind)}>
            <option value="file_changed">{tr("ui.5d511819bb13")}</option>
            <option value="folder_added">{tr("ui.dc9593b980e0")}</option>
            <option value="schedule">{tr("ui.46a348e8a5e1")}</option>
            <option value="hotkey">{tr("ui.a2c39c2d5f86")}</option>
          </select>
        </label>
        <label>
          {model.triggerKind === "schedule"
            ? tr("ui.6c7f21d2734b") : model.triggerKind === "hotkey"
            ? tr("ui.31e331076595") : tr("ui.71cd4f2ba1d2")}
          <input value={model.triggerValue} onChange={(event) => actions.onValueChange(event.target.value)}/>
        </label>
        <button className="primary-button" type="submit" disabled={!model.selectedProjectId ||
            !model.triggerName.trim() ||
            model.triggerBusy}>
          {model.triggerBusy
            ? <LoaderCircle className="spin" size={14}/>
            : <Play size={14}/>}{tr("ui.5cf15c2f8c5d")}</button>
        <p>{tr("ui.d36b904b8646")}</p>
      </form>

      <div className="local-trigger-list">
        {model.triggers.map((trigger) => (<article key={trigger.triggerId}>
            <div>
              <span className={`trigger-status ${trigger.status}`}/>
              <div>
                <strong>{trigger.name}</strong>
                <small>{localTriggerLabel(trigger)}</small>
              </div>
            </div>
            <div className="trigger-actions">
              <button type="button" title={trigger.enabled ? tr("ui.be70be5a2e12") : tr("ui.d4e9ca3dd494")} disabled={model.triggerBusy} onClick={() => actions.onToggle(trigger)}>
                {trigger.enabled ? <Square size={13}/> : <Check size={13}/>}
              </button>
              <button type="button" title={tr("ui.e274aebb24ec")} disabled={model.triggerBusy} onClick={() => actions.onFire(trigger.triggerId)}>
                <Play size={13}/>
              </button>
              <button type="button" title={tr("ui.2f752c005ec5")} disabled={model.triggerBusy} onClick={() => actions.onRemove(trigger.triggerId)}>
                <Trash2 size={13}/>
              </button>
            </div>
            {trigger.lastError && <p>{trigger.lastError}</p>}
            <time>
              {trigger.lastFiredAt
                ? tr("ui.e85ea5b13d13", [new Date(trigger.lastFiredAt).toLocaleString()]) : tr("ui.baf7f1149c9f")}
            </time>
          </article>))}
        {model.triggers.length === 0 && (<div className="workflow-registry-empty">
            <Activity size={26}/>
            <span>{tr("ui.c89fba8b110a")}</span>
          </div>)}
      </div>
    </div>);
}
function localTriggerLabel(trigger: LocalTriggerSummary): string {
    if (trigger.kind === "file_changed")
        return tr("ui.fac0bd1a9b68", [trigger.relativePath]);
    if (trigger.kind === "folder_added")
        return tr("ui.8c02551c42ea", [trigger.relativePath]);
    if (trigger.kind === "schedule")
        return tr("ui.eb7fa47f340d", [trigger.intervalMinutes]);
    return tr("ui.16ab9ae43804", [trigger.accelerator]);
}
