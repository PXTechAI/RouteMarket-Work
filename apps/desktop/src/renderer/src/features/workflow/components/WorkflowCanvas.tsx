import "./workflow-canvas.scss";
import { tr } from "../../../i18n";
import { CircleAlert, FilePlus2, LayoutGrid, LoaderCircle, Save, Trash2, Workflow, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
import { validateWorkflowDraftGraph } from "../workflow-draft-graph";
import { shouldAutoOpenWorkflowRunPanel } from "../workflow-run-visibility";
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
    const [createPanelOpen, setCreatePanelOpen] = useState(false);
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
        if (shouldAutoOpenWorkflowRunPanel(model.selectedRun)) {
            setRunPanelOpen(true);
        }
    }, [model.selectedRun]);
    useEffect(() => {
        if (!createPanelOpen) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setCreatePanelOpen(false);
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [createPanelOpen]);
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
        <div className="workflow-toolbar-group workflow-toolbar-primary">
          <button className={createPanelOpen ? "active" : ""} type="button" aria-expanded={createPanelOpen} onClick={() => setCreatePanelOpen((current) => !current)}>
            <FilePlus2 size={15}/>{tr("ui.fdba55f21698")}</button>
          <button type="button" onClick={() => actions.onCreateDraft("local_action")}>
            <Workflow size={15}/>{tr("ui.43db3971ff35")}</button>
        </div>

        <div className="workflow-toolbar-divider"/>

        <div className="workflow-toolbar-group workflow-toolbar-nodes">
          <select className="workflow-executor-select" value={model.addExecutor} aria-label={tr("ui.469aa8b34759")} onChange={(event) => actions.onAddExecutorChange(event.target.value)}>
            <option value="">{tr("ui.1ff592304be4")}</option>
            {availableDefinitions.map((definition) => (<option key={definition.executorKey} value={definition.executorKey} disabled={!definition.available}>
                {definition.title} · {definition.executorKey}
              </option>))}
          </select>
          <button type="button" disabled={!model.addExecutor || !model.draft} onClick={() => actions.onAddNode()}>
            <FilePlus2 size={15}/>{tr("ui.94191ce210d3")}</button>
          <button className="workflow-icon-button" type="button" title={tr("ui.8c68172f1ec8")} aria-label={tr("ui.8c68172f1ec8")} disabled={!model.draft?.edges.length} onClick={actions.onClearEdges}>
            <X size={15}/></button>
          <button className="workflow-icon-button" type="button" title={tr("ui.a3aeef6e3504")} aria-label={tr("ui.bd63f469a7e6")} disabled={(model.draft?.nodes.length ?? 0) < 2 || model.draftBusy} onClick={actions.onAutoLayout}>
            <LayoutGrid size={15}/></button>
        </div>

        <div className="workflow-toolbar-spacer"/>

        <div className="workflow-toolbar-group workflow-toolbar-actions">
          <button className="workflow-save-button" type="button" disabled={!model.draft || !model.draftDirty || model.draftBusy} onClick={actions.onSaveDraft}>
            {model.draftBusy
              ? <LoaderCircle className="spin" size={15}/>
              : <Save size={15}/>}{tr("ui.fadf24dbc5a9")}</button>
          <button className="workflow-delete-button" type="button" title={tr("ui.59358b12cb92")} disabled={!model.draft || model.draftBusy} onClick={actions.onDeleteDraft}>
            <Trash2 size={15}/>
          </button>
        </div>
      </div>

      {createPanelOpen && (<div
          className="workflow-create-overlay"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCreatePanelOpen(false);
          }}
        >
          <div className="workflow-create-dialog" role="dialog" aria-modal="true" aria-label={tr("ui.fdba55f21698")}>
            <WorkflowSkillSetup
              model={model}
              actions={actions}
              onCreateBlank={() => {
                actions.onCreateDraft("workflow");
                setCreatePanelOpen(false);
              }}
              onCreated={() => setCreatePanelOpen(false)}
              onClose={() => setCreatePanelOpen(false)}
            />
          </div>
        </div>)}

      {graphIssues.length > 0 && (<div className={`workflow-graph-validation ${graphIssues.some((issue) => issue.level === "error")
                ? "error"
                : "warning"}`} role="status">
          <CircleAlert size={14}/>
          <strong>{tr("ui.bf01496ef8d1")}</strong>
          <span>{graphIssues[0]!.message}</span>
          {graphIssues.length > 1 && <small>{tr("ui.7eeca0f2fd8d")}{graphIssues.length - 1}{tr("ui.64728a772742")}</small>}
        </div>)}

      <DesktopWorkflowFlow
        draft={model.draft}
        definitions={availableDefinitions}
        selectedRun={model.selectedRun}
        busy={model.draftBusy}
        fitViewRevision={model.fitViewRevision}
        selectedNodeIds={selectedNodeIds}
        onSelectNodes={selectWorkflowNodes}
        onConfigureNode={setConfiguredNodeId}
        onAddNode={(executorKey, position) => actions.onAddNode({ executorKey, position })}
        onMoveNodes={actions.onMoveNodes}
        onConnectNodes={actions.onConnectNodes}
        onRemoveNode={removeWorkflowNode}
        onRemoveNodes={actions.onRemoveNodes}
        onDuplicateNodes={actions.onDuplicateNodes}
        onRemoveEdges={actions.onRemoveEdges}
        configPanel={selectedNode && (<WorkflowNodeConfigPanel node={selectedNode} actions={actions} onClose={() => setConfiguredNodeId(null)}/>)}
      />

      <WorkflowRunPanel model={model} actions={actions} expanded={runPanelOpen} onExpandedChange={setRunPanelOpen}/>

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
