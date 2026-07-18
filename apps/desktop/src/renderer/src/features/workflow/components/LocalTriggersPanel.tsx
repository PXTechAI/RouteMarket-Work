import {
  Activity,
  Check,
  LoaderCircle,
  Play,
  Square,
  Trash2
} from "lucide-react";
import type {
  LocalTriggerKind,
  LocalTriggerSummary
} from "../../../../../shared/desktop-api";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";

export function LocalTriggersPanel({
  model,
  actions
}: {
  model: Pick<
    WorkflowPageModel,
    | "selectedProjectId"
    | "triggers"
    | "triggerName"
    | "triggerKind"
    | "triggerValue"
    | "triggerBusy"
  >;
  actions: WorkflowPageActions["triggers"];
}) {
  return (
    <div className="local-trigger-layout">
      <form
        className="local-trigger-form"
        onSubmit={(event) => {
          event.preventDefault();
          actions.onCreate();
        }}
      >
        <h3>新建触发器</h3>
        <label>
          名称
          <input
            value={model.triggerName}
            placeholder="例如：源文件变化"
            onChange={(event) => actions.onNameChange(event.target.value)}
          />
        </label>
        <label>
          类型
          <select
            value={model.triggerKind}
            onChange={(event) =>
              actions.onKindChange(event.target.value as LocalTriggerKind)}
          >
            <option value="file_changed">文件变更</option>
            <option value="folder_added">文件夹新增</option>
            <option value="schedule">本地定时</option>
            <option value="hotkey">全局快捷键</option>
          </select>
        </label>
        <label>
          {model.triggerKind === "schedule"
            ? "间隔（分钟）"
            : model.triggerKind === "hotkey"
              ? "快捷键"
              : "项目内路径"}
          <input
            value={model.triggerValue}
            onChange={(event) => actions.onValueChange(event.target.value)}
          />
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={
            !model.selectedProjectId ||
            !model.triggerName.trim() ||
            model.triggerBusy
          }
        >
          {model.triggerBusy
            ? <LoaderCircle className="spin" size={14} />
            : <Play size={14} />}
          创建并启用
        </button>
        <p>
          文件路径必须位于当前项目内。快捷键与文件监听在应用退出时自动释放，并在下次启动恢复。
        </p>
      </form>

      <div className="local-trigger-list">
        {model.triggers.map((trigger) => (
          <article key={trigger.triggerId}>
            <div>
              <span className={`trigger-status ${trigger.status}`} />
              <div>
                <strong>{trigger.name}</strong>
                <small>{localTriggerLabel(trigger)}</small>
              </div>
            </div>
            <div className="trigger-actions">
              <button
                type="button"
                title={trigger.enabled ? "禁用" : "启用"}
                disabled={model.triggerBusy}
                onClick={() => actions.onToggle(trigger)}
              >
                {trigger.enabled ? <Square size={13} /> : <Check size={13} />}
              </button>
              <button
                type="button"
                title="立即测试"
                disabled={model.triggerBusy}
                onClick={() => actions.onFire(trigger.triggerId)}
              >
                <Play size={13} />
              </button>
              <button
                type="button"
                title="移除"
                disabled={model.triggerBusy}
                onClick={() => actions.onRemove(trigger.triggerId)}
              >
                <Trash2 size={13} />
              </button>
            </div>
            {trigger.lastError && <p>{trigger.lastError}</p>}
            <time>
              {trigger.lastFiredAt
                ? `最近触发 ${new Date(trigger.lastFiredAt).toLocaleString()}`
                : "尚未触发"}
            </time>
          </article>
        ))}
        {model.triggers.length === 0 && (
          <div className="workflow-registry-empty">
            <Activity size={26} />
            <span>当前项目还没有本地触发器</span>
          </div>
        )}
      </div>
    </div>
  );
}

function localTriggerLabel(trigger: LocalTriggerSummary): string {
  if (trigger.kind === "file_changed") return `文件变更 · ${trigger.relativePath}`;
  if (trigger.kind === "folder_added") return `文件夹新增 · ${trigger.relativePath}`;
  if (trigger.kind === "schedule") return `每 ${trigger.intervalMinutes} 分钟`;
  return `快捷键 · ${trigger.accelerator}`;
}
