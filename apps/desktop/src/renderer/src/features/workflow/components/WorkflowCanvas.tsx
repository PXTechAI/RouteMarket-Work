import { tr } from "../../../i18n";
import { CircleAlert, FilePlus2, LayoutGrid, LoaderCircle, PanelBottomOpen, Save, Trash2, Redo2, Undo2, Workflow, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
import { validateWorkflowDraftGraph } from "../workflow-draft-graph";
import { DesktopWorkflowFlow } from "./DesktopWorkflowFlow";
import { WorkflowSkillSetup } from "./WorkflowSkillSetup";
import { WorkflowNodeConfigPanel } from "./WorkflowNodeConfigPanel";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
export function WorkflowCanvas({ model, actions }: {
    model: WorkflowPageModel;
    actions: WorkflowPageActions["canvas"];
}) {
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
    const [configuredNodeId, setConfiguredNodeId] = useState<string | null>(null);
    const [runPanelOpen, setRunPanelOpen] = useState(false);
    const availableDefinitions = model.registry?.definitions.filter((definition) => definition.executorKey !== `subworkflow.local.${model.draft?.workflowId}`) ?? [];
    const graphIssues = model.draft
        ? validateWorkflowDraftGraph(model.draft)
        : [];
    const selectedNode = model.draft?.nodes.find((node) => node.nodeId === configuredNodeId) ?? null;
    const selectWorkflowNodes = useCallback((nodeIds: string[]) => {
        setSelectedNodeIds((current) => sameNodeSelection(current, nodeIds) ? current : nodeIds);
    }, []);
    const removeWorkflowNode = useCallback((nodeId: string) => {
        actions.onRemoveNode(nodeId);
        setSelectedNodeIds((current) => current.filter((selectedId) => selectedId !== nodeId));
        setConfiguredNodeId((current) => current === nodeId ? null : current);
    }, [actions]);
    useEffect(() => {
        const availableIds = new Set(model.draft?.nodes.map((node) => node.nodeId));
        setSelectedNodeIds((current) => {
            const next = current.filter((nodeId) => availableIds.has(nodeId));
            return next.length === current.length ? current : next;
        });
        if (configuredNodeId && !availableIds.has(configuredNodeId)) {
            setConfiguredNodeId(null);
        }
    }, [configuredNodeId, model.draft?.nodes]);
    useEffect(() => {
        const handleDuplicateShortcut = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "d" ||
                (!event.ctrlKey && !event.metaKey) ||
                event.altKey ||
                isEditableTarget(event.target) ||
                !selectedNodeIds.length) {
                return;
            }
            event.preventDefault();
            selectWorkflowNodes(actions.onDuplicateNodes(selectedNodeIds));
        };
        window.addEventListener("keydown", handleDuplicateShortcut);
        return () => window.removeEventListener("keydown", handleDuplicateShortcut);
    }, [actions, selectWorkflowNodes, selectedNodeIds]);
    return (<div className="workflow-canvas-layout">
      <div className="workflow-canvas-toolbar">
        <select className="workflow-draft-select" value={model.draft?.workflowId ?? ""} aria-label={tr("ui.a0d24ca065c5")} onChange={(event) => actions.onSelectDraft(event.target.value)}>
          {model.draft &&
            !model.drafts.some((item) => item.workflowId === model.draft?.workflowId) && (<option value={model.draft.workflowId}>{model.draft.name}{tr("ui.03fc38a6b1ed")}</option>)}
          {model.drafts.map((draft) => (<option key={draft.workflowId} value={draft.workflowId}>
              {draft.kind === "local_action" ? tr("ui.d9d9827827e1") : tr("ui.cc19798b0c12")} · {draft.name}
            </option>))}
        </select>
        <button type="button" onClick={() => actions.onCreateDraft("workflow")}>
          <FilePlus2 size={13}/>{tr("ui.fdba55f21698")}</button>
        <button type="button" onClick={() => actions.onCreateDraft("local_action")}>
          <Workflow size={13}/>{tr("ui.43db3971ff35")}</button>
        <input className="workflow-name-input" value={model.draft?.name ?? ""} aria-label={tr("ui.2c447fbe91b7")} disabled={!model.draft} onChange={(event) => actions.onDraftNameChange(event.target.value)}/>
        {model.draft?.sourceSkill && (<span className="workflow-skill-origin" title={model.draft.sourceSkill.id}>
            Skill · v{model.draft.sourceSkill.version}
          </span>)}
        <select className="workflow-executor-select" value={model.addExecutor} aria-label={tr("ui.469aa8b34759")} onChange={(event) => actions.onAddExecutorChange(event.target.value)}>
          <option value="">{tr("ui.1ff592304be4")}</option>
          {availableDefinitions.map((definition) => (<option key={definition.executorKey} value={definition.executorKey} disabled={!definition.available}>
              {definition.title} · {definition.executorKey}
            </option>))}
        </select>
        <button type="button" disabled={!model.addExecutor || !model.draft} onClick={actions.onAddNode}>
          <FilePlus2 size={13}/>{tr("ui.94191ce210d3")}</button>
        <button type="button" disabled={!model.draft?.edges.length} onClick={actions.onClearEdges}>
          <X size={13}/>{tr("ui.8c68172f1ec8")}</button>
        <button type="button" title={tr("ui.a3aeef6e3504")} disabled={(model.draft?.nodes.length ?? 0) < 2 || model.draftBusy} onClick={actions.onAutoLayout}>
          <LayoutGrid size={13}/>{tr("ui.bd63f469a7e6")}</button>
        <button type="button" title={tr("ui.3fe650dc6ef0")} aria-label={tr("ui.9fcefd8dc81e")} disabled={!model.canUndoDraft || model.draftBusy} onClick={actions.onUndoDraft}>
          <Undo2 size={13}/>
        </button>
        <button type="button" title={tr("ui.60df20024887")} aria-label={tr("ui.1238f0d36361")} disabled={!model.canRedoDraft || model.draftBusy} onClick={actions.onRedoDraft}>
          <Redo2 size={13}/>
        </button>
        <button className={runPanelOpen ? "active" : ""} type="button" aria-pressed={runPanelOpen} onClick={() => setRunPanelOpen((current) => !current)}>
          <PanelBottomOpen size={13}/>{tr("ui.3ad307cd3ff7")}</button>
        <button className="workflow-save-button" type="button" disabled={!model.draft || !model.draftDirty || model.draftBusy} onClick={actions.onSaveDraft}>
          {model.draftBusy
            ? <LoaderCircle className="spin" size={13}/>
            : <Save size={13}/>}{tr("ui.fadf24dbc5a9")}</button>
        <button className="workflow-delete-button" type="button" title={tr("ui.59358b12cb92")} disabled={!model.draft || model.draftBusy} onClick={actions.onDeleteDraft}>
          <Trash2 size={13}/>
        </button>
      </div>

      <WorkflowSkillSetup model={model} actions={actions}/>

      {graphIssues.length > 0 && (<div className={`workflow-graph-validation ${graphIssues.some((issue) => issue.level === "error")
                ? "error"
                : "warning"}`} role="status">
          <CircleAlert size={14}/>
          <strong>{tr("ui.bf01496ef8d1")}</strong>
          <span>{graphIssues[0]!.message}</span>
          {graphIssues.length > 1 && <small>{tr("ui.7eeca0f2fd8d")}{graphIssues.length - 1}{tr("ui.64728a772742")}</small>}
        </div>)}

      <DesktopWorkflowFlow draft={model.draft} selectedRun={model.selectedRun} busy={model.draftBusy} fitViewRevision={model.fitViewRevision} selectedNodeIds={selectedNodeIds} onSelectNodes={selectWorkflowNodes} onConfigureNode={setConfiguredNodeId} onMoveNodes={actions.onMoveNodes} onConnectNodes={actions.onConnectNodes} onRemoveNode={removeWorkflowNode} onRemoveNodes={actions.onRemoveNodes} onDuplicateNodes={actions.onDuplicateNodes} onRemoveEdges={actions.onRemoveEdges}/>

      {selectedNode && (<WorkflowNodeConfigPanel node={selectedNode} actions={actions} onClose={() => setConfiguredNodeId(null)}/>)}

      {runPanelOpen && <WorkflowRunPanel model={model} actions={actions}/>}

      <div className="workflow-canvas-status">
        <span>
          {model.draft?.kind === "local_action" ? tr("ui.80cbf6cea938") : tr("ui.cc19798b0c12")}
          {" · "}
          {model.draft?.nodes.length ?? 0}{tr("ui.67ff2a2cd962")}{model.draft?.edges.length ?? 0}{tr("ui.99276b8f6d58")}</span>
        <span>
          {model.draftDirty
            ? tr("ui.7fbaa2eee695") : model.draft?.updatedAt
            ? tr("ui.5ef815d634c4", [new Date(model.draft.updatedAt).toLocaleString()]) : tr("ui.8107ccd58593")}
        </span>
      </div>
    </div>);
}
function sameNodeSelection(current: string[], next: string[]): boolean {
    return current.length === next.length &&
        current.every((nodeId) => next.includes(nodeId));
}
function isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement &&
        (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
