import {
  FilePlus2,
  GitBranch,
  LoaderCircle,
  Save,
  Trash2,
  Workflow,
  X
} from "lucide-react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
import { WorkflowRunPanel } from "./WorkflowRunPanel";

export function WorkflowCanvas({
  model,
  actions
}: {
  model: WorkflowPageModel;
  actions: WorkflowPageActions["canvas"];
}) {
  const availableDefinitions = model.registry?.definitions.filter(
    (definition) =>
      definition.executorKey !== `subworkflow.local.${model.draft?.workflowId}`
  ) ?? [];

  return (
    <div className="workflow-canvas-layout">
      <div className="workflow-canvas-toolbar">
        <select
          value={model.draft?.workflowId ?? ""}
          aria-label="工作流草稿"
          onChange={(event) => actions.onSelectDraft(event.target.value)}
        >
          {model.draft &&
            !model.drafts.some((item) => item.workflowId === model.draft?.workflowId) && (
              <option value={model.draft.workflowId}>{model.draft.name} · 未保存</option>
            )}
          {model.drafts.map((draft) => (
            <option key={draft.workflowId} value={draft.workflowId}>
              {draft.kind === "local_action" ? "动作" : "工作流"} · {draft.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => actions.onCreateDraft("workflow")}>
          <FilePlus2 size={13} />
          新工作流
        </button>
        <button type="button" onClick={() => actions.onCreateDraft("local_action")}>
          <Workflow size={13} />
          本地动作
        </button>
        <input
          className="workflow-name-input"
          value={model.draft?.name ?? ""}
          aria-label="工作流名称"
          disabled={!model.draft}
          onChange={(event) => actions.onDraftNameChange(event.target.value)}
        />
        <select
          value={model.addExecutor}
          aria-label="待添加节点"
          onChange={(event) => actions.onAddExecutorChange(event.target.value)}
        >
          <option value="">选择节点…</option>
          {availableDefinitions.map((definition) => (
            <option
              key={definition.executorKey}
              value={definition.executorKey}
              disabled={!definition.available}
            >
              {definition.title} · {definition.executorKey}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!model.addExecutor || !model.draft}
          onClick={actions.onAddNode}
        >
          <FilePlus2 size={13} />
          添加
        </button>
        <select
          value={model.edgeSource}
          aria-label="连线起点"
          onChange={(event) => actions.onEdgeSourceChange(event.target.value)}
        >
          <option value="">起点…</option>
          {model.draft?.nodes.map((node) => (
            <option key={node.nodeId} value={node.nodeId}>{node.title}</option>
          ))}
        </select>
        <select
          value={model.edgeTarget}
          aria-label="连线终点"
          onChange={(event) => actions.onEdgeTargetChange(event.target.value)}
        >
          <option value="">终点…</option>
          {model.draft?.nodes.map((node) => (
            <option key={node.nodeId} value={node.nodeId}>{node.title}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={
            !model.edgeSource ||
            !model.edgeTarget ||
            model.edgeSource === model.edgeTarget
          }
          onClick={actions.onConnectNodes}
        >
          <GitBranch size={13} />
          连线
        </button>
        <button
          type="button"
          disabled={!model.draft?.edges.length}
          onClick={actions.onClearEdges}
        >
          <X size={13} />
          清除线
        </button>
        <button
          className="workflow-save-button"
          type="button"
          disabled={!model.draft || !model.draftDirty || model.draftBusy}
          onClick={actions.onSaveDraft}
        >
          {model.draftBusy
            ? <LoaderCircle className="spin" size={13} />
            : <Save size={13} />}
          保存
        </button>
        <button
          className="workflow-delete-button"
          type="button"
          title="删除草稿"
          disabled={!model.draft || model.draftBusy}
          onClick={actions.onDeleteDraft}
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="workflow-canvas-scroll">
        <div className="workflow-canvas-surface">
          <svg className="workflow-edge-layer" aria-hidden="true">
            {model.draft?.edges.map((edge) => {
              const source = model.draft?.nodes.find(
                (node) => node.nodeId === edge.sourceNodeId
              );
              const target = model.draft?.nodes.find(
                (node) => node.nodeId === edge.targetNodeId
              );
              return source && target ? (
                <path
                  key={edge.edgeId}
                  d={`M ${source.x + 190} ${source.y + 45} C ${source.x + 220} ${source.y + 45}, ${target.x - 30} ${target.y + 45}, ${target.x} ${target.y + 45}`}
                />
              ) : null;
            })}
          </svg>
          {model.draft?.nodes.map((node) => (
            <article
              key={node.nodeId}
              className={[
                "workflow-canvas-node",
                model.selectedRun?.nodeRuns.find(
                  (nodeRun) => nodeRun.nodeId === node.nodeId
                )?.status ?? ""
              ].filter(Boolean).join(" ")}
              style={{ left: node.x, top: node.y }}
            >
              <div>
                <span>{node.executionTarget}</span>
                <button
                  type="button"
                  title="删除节点"
                  onClick={() => actions.onRemoveNode(node.nodeId)}
                >
                  <X size={12} />
                </button>
              </div>
              <strong>{node.title}</strong>
              <code>{node.executorKey}</code>
              <small>
                {node.definitionSnapshot.portability} · v
                {node.definitionSnapshot.definitionVersion}
              </small>
            </article>
          ))}
          {!model.draftBusy && model.draft?.nodes.length === 0 && (
            <div className="workflow-canvas-empty">
              <Workflow size={30} />
              <h3>搭建第一个混合工作流</h3>
              <p>从上方选择一个当前设备可用的节点并添加到画布。</p>
            </div>
          )}
          {model.draftBusy && (
            <div className="workflow-canvas-empty">
              <LoaderCircle className="spin" size={28} />
              <p>正在加载本地草稿…</p>
            </div>
          )}
        </div>
      </div>

      <WorkflowRunPanel model={model} actions={actions} />

      <div className="workflow-canvas-status">
        <span>
          {model.draft?.kind === "local_action" ? "可复用本地动作" : "工作流"}
          {" · "}
          {model.draft?.nodes.length ?? 0} 个节点 · {model.draft?.edges.length ?? 0} 条连线
        </span>
        <span>
          {model.draftDirty
            ? "有未保存更改"
            : model.draft?.updatedAt
              ? `已保存 ${new Date(model.draft.updatedAt).toLocaleString()}`
              : "本地草稿"}
        </span>
      </div>
    </div>
  );
}
