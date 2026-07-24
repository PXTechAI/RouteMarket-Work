import {
  CircleAlert,
  CircleCheck,
  Clock3,
  Hand,
  LoaderCircle,
  Play,
  RotateCcw,
  Square
} from "lucide-react";
import type {
  DesktopWorkflowNodeRun,
  DesktopWorkflowRun
} from "../../../../../shared/desktop-api";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";

export function WorkflowRunPanel({
  model,
  actions
}: {
  model: WorkflowPageModel;
  actions: WorkflowPageActions["canvas"];
}) {
  const run = model.selectedRun;
  const waitingForUser = run?.status === "waiting_for_user";
  const running =
    run?.status === "queued" ||
    run?.status === "running" ||
    waitingForUser;
  const canRun = Boolean(
    model.draft &&
    model.draft.kind === "workflow" &&
    model.draft.nodes.length &&
    !model.draftDirty &&
    !running &&
    !model.runBusy
  );

  return (
    <section className="workflow-run-panel" aria-label="Workflow 运行">
      <div className="workflow-run-controls">
        <label>
          <span>运行输入</span>
          <textarea
            value={model.runInput}
            spellCheck={false}
            onChange={(event) => actions.onRunInputChange(event.target.value)}
          />
        </label>
        <div className="workflow-run-actions">
          <button type="button" disabled={!canRun} onClick={actions.onRun}>
            {model.runBusy
              ? <LoaderCircle className="spin" size={13} />
              : <Play size={13} />}
            运行
          </button>
          <button
            type="button"
            disabled={!running || model.runBusy}
            onClick={actions.onCancelRun}
          >
            <Square size={12} />
            取消
          </button>
          <button
            type="button"
            disabled={!run || running || model.runBusy}
            onClick={actions.onRetryRun}
          >
            <RotateCcw size={13} />
            重试
          </button>
        </div>
        {waitingForUser && (
          <div className="workflow-user-action" role="status">
            <Hand size={16} />
            <div>
              <strong>需要你在浏览器中完成操作</strong>
              <small>完成登录或验证码后，从当前步骤继续；不会重新打开页面。</small>
            </div>
            <button
              type="button"
              disabled={model.runBusy}
              onClick={actions.onResumeRun}
            >
              处理完成，继续
            </button>
          </div>
        )}
        <div className={`workflow-run-summary ${run?.status ?? "idle"}`}>
          <RunStatusIcon run={run} />
          <div>
            <strong>{run ? statusLabel(run.status) : "尚未运行"}</strong>
            <small>
              {run
                ? `${run.nodeRuns.filter((node) => node.status === "succeeded").length}/${run.nodeRuns.length} 个节点完成`
                : "保存工作流后即可在本机执行"}
            </small>
          </div>
        </div>
      </div>

      <div className="workflow-run-timeline">
        {run?.nodeRuns.map((node) => (
          <NodeRunItem key={node.nodeRunId} node={node} />
        ))}
        {!run && (
          <div className="workflow-run-empty">
            运行记录会在这里显示每个节点的输入、输出与错误。
          </div>
        )}
      </div>
    </section>
  );
}

function NodeRunItem({ node }: { node: DesktopWorkflowNodeRun }) {
  return (
    <article className={`workflow-node-run ${node.status}`}>
      <span className="workflow-node-run-dot" />
      <div>
        <strong>{node.title}</strong>
        <code>{node.executorKey}</code>
      </div>
      <span>{nodeStatusLabel(node.status)}</span>
      {(node.error || node.output !== null) && (
        <details>
          <summary>{node.error ? "错误" : "结果"}</summary>
          <pre>{node.error ?? formatValue(node.output)}</pre>
        </details>
      )}
    </article>
  );
}

function RunStatusIcon({ run }: { run: DesktopWorkflowRun | null }) {
  if (!run) return <Clock3 size={16} />;
  if (run.status === "queued" || run.status === "running") {
    return <LoaderCircle className="spin" size={16} />;
  }
  if (run.status === "waiting_for_user") return <Hand size={16} />;
  if (run.status === "succeeded") return <CircleCheck size={16} />;
  return <CircleAlert size={16} />;
}

function statusLabel(status: DesktopWorkflowRun["status"]): string {
  return {
    queued: "等待运行",
    running: "正在运行",
    waiting_for_user: "等待你处理",
    succeeded: "运行成功",
    failed: "运行失败",
    canceled: "已取消"
  }[status];
}

function nodeStatusLabel(status: DesktopWorkflowNodeRun["status"]): string {
  return {
    pending: "等待",
    running: "运行中",
    waiting_for_user: "等待你处理",
    succeeded: "成功",
    failed: "失败",
    skipped: "已跳过",
    canceled: "已取消"
  }[status];
}

function formatValue(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized && serialized.length > 4_000
    ? `${serialized.slice(0, 4_000)}\n...`
    : serialized ?? String(value);
}
