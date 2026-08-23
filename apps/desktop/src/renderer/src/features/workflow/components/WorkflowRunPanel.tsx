import "./workflow-run-panel.scss";
import { tr } from "../../../i18n";
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, Clock3, ExternalLink, FolderOpen, Hand, LoaderCircle, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesktopWorkflowNodeRun, DesktopWorkflowRun } from "../../../../../shared/desktop-api";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
type WorkflowRunTab = "nodes" | "input" | "results";

export function WorkflowRunPanel({ model, actions, expanded, onExpandedChange }: {
    model: WorkflowPageModel;
    actions: WorkflowPageActions["canvas"];
    expanded: boolean;
    onExpandedChange(expanded: boolean): void;
}) {
    const [activeTab, setActiveTab] = useState<WorkflowRunTab>("nodes");
    const run = model.selectedRun;
    const waitingForUser = run?.status === "waiting_for_user";
    const artifact = workflowArtifact(run);
    const resultNodes = run?.nodeRuns.filter((node) => node.error || node.output !== null) ?? [];
    const running = run?.status === "queued" ||
        run?.status === "running" ||
        waitingForUser;
    const succeededCount = run?.nodeRuns.filter((node) => node.status === "succeeded").length ?? 0;
    const canRun = Boolean(model.draft &&
        model.draft.kind === "workflow" &&
        model.draft.nodes.length &&
        !model.draftDirty &&
        !running &&
        !model.runBusy);
    useEffect(() => {
        if (waitingForUser) setActiveTab("nodes");
    }, [waitingForUser]);
    return (<section className={`workflow-run-panel${expanded ? " expanded" : " collapsed"}`} aria-label={tr("ui.ede2b42f0c9e")}>
      <header className="workflow-run-header">
        <button
          className={`workflow-run-summary ${run?.status ?? "idle"}`}
          type="button"
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          <RunStatusIcon run={run}/>
          <span>
            <strong>{run ? statusLabel(run.status) : tr("ui.5afa7a985132")}</strong>
            <small>{run
              ? tr("ui.76ab9c521029", [succeededCount, run.nodeRuns.length])
              : tr("ui.637b9bfc0904")}</small>
          </span>
        </button>
        <div className="workflow-run-actions">
          <button type="button" disabled={!canRun} onClick={actions.onRun}>
            {model.runBusy
            ? <LoaderCircle className="spin" size={13}/>
            : <Play size={13}/>}{tr("ui.0c3acd446f19")}</button>
          <button type="button" disabled={!running || model.runBusy} onClick={actions.onCancelRun}>
            <Square size={12}/>{tr("ui.4d0b4688c787")}</button>
          <button type="button" disabled={!run || running || model.runBusy} onClick={actions.onRetryRun}>
            <RotateCcw size={13}/>{tr("ui.e2d53a6d3a6a")}</button>
        </div>
        <button
          className="workflow-run-expand"
          type="button"
          title={expanded ? tr("workflow.run.collapse") : tr("workflow.run.expand")}
          aria-label={expanded ? tr("workflow.run.collapse") : tr("workflow.run.expand")}
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
        </button>
      </header>

      {waitingForUser && (<div className="workflow-user-action" role="status">
          <Hand size={18}/>
          <div>
            <strong>{tr("ui.352047da964f")}</strong>
            <small>{tr("ui.71dd334e28a4")}</small>
          </div>
          <button type="button" disabled={model.runBusy} onClick={actions.onResumeRun}>{tr("ui.c57c2805980c")}</button>
        </div>)}

      {expanded && (<>
        <nav className="workflow-run-tabs" aria-label={tr("ui.ede2b42f0c9e")}>
          <RunTab tab="nodes" active={activeTab} onSelect={setActiveTab}>{tr("workflow.run.nodes")}</RunTab>
          <RunTab tab="input" active={activeTab} onSelect={setActiveTab}>{tr("workflow.run.input")}</RunTab>
          <RunTab tab="results" active={activeTab} onSelect={setActiveTab}>{tr("workflow.run.results")}</RunTab>
        </nav>
        <div className="workflow-run-content">
          {activeTab === "nodes" && (<div className="workflow-run-timeline">
              {run?.nodeRuns.map((node) => (<NodeRunItem key={node.nodeRunId} node={node}/>))}
              {!run && (<div className="workflow-run-empty">{tr("ui.ca0bd6db21cf")}</div>)}
            </div>)}
          {activeTab === "input" && (<label className="workflow-run-input">
              <span>{tr("workflow.run.input")}</span>
              <small>{tr("workflow.run.inputHint")}</small>
              <textarea value={model.runInput} spellCheck={false} onChange={(event) => actions.onRunInputChange(event.target.value)}/>
            </label>)}
          {activeTab === "results" && (<div className="workflow-run-results">
              {artifact && (<div className="workflow-run-artifact">
                  <div>
                    <strong>{artifact.fileName}</strong>
                    <small title={artifact.savedPath}>{artifact.savedPath}</small>
                  </div>
                  <button type="button" disabled={model.runBusy} onClick={() => actions.onOpenRunArtifact("open")}>
                    <ExternalLink size={12}/>{tr("ui.65fc81e16119")}</button>
                  <button type="button" disabled={model.runBusy} onClick={() => actions.onOpenRunArtifact("reveal")}>
                    <FolderOpen size={12}/>{tr("ui.786fef40f814")}</button>
                </div>)}
              {resultNodes.map((node) => (<NodeRunItem key={node.nodeRunId} node={node}/>))}
              {!artifact && !resultNodes.length && (<div className="workflow-run-empty">{tr("workflow.run.noResults")}</div>)}
            </div>)}
        </div>
      </>)}
    </section>);
}

function RunTab({ tab, active, onSelect, children }: {
    tab: WorkflowRunTab;
    active: WorkflowRunTab;
    onSelect(tab: WorkflowRunTab): void;
    children: string;
}) {
    return (<button type="button" aria-current={active === tab ? "page" : undefined} onClick={() => onSelect(tab)}>{children}</button>);
}
function NodeRunItem({ node }: {
    node: DesktopWorkflowNodeRun;
}) {
    return (<article className={`workflow-node-run ${node.status}`}>
      <span className="workflow-node-run-dot"/>
      <div>
        <strong>{node.title}</strong>
        <code>{node.executorKey}</code>
      </div>
      <span>{nodeStatusLabel(node.status)}</span>
      {(node.error || node.output !== null) && (<details>
          <summary>{node.error ? tr("ui.b859c7be7501") : tr("ui.0a2c91cec6c8")}</summary>
          <pre>{node.error ?? formatValue(node.output)}</pre>
        </details>)}
    </article>);
}
function RunStatusIcon({ run }: {
    run: DesktopWorkflowRun | null;
}) {
    if (!run)
        return <Clock3 size={16}/>;
    if (run.status === "queued" || run.status === "running") {
        return <LoaderCircle className="spin" size={16}/>;
    }
    if (run.status === "waiting_for_user")
        return <Hand size={16}/>;
    if (run.status === "succeeded")
        return <CircleCheck size={16}/>;
    return <CircleAlert size={16}/>;
}
function statusLabel(status: DesktopWorkflowRun["status"]): string {
    return {
        queued: tr("ui.d925b1297a04"),
        running: tr("ui.3488ded27c76"),
        waiting_for_user: tr("ui.059f99450f1c"),
        succeeded: tr("ui.1eefb128dddc"),
        failed: tr("ui.f5f12f1d7a73"),
        canceled: tr("ui.a5ffdc95eeb0")
    }[status];
}
function nodeStatusLabel(status: DesktopWorkflowNodeRun["status"]): string {
    return {
        pending: tr("ui.25d23b92b225"),
        running: tr("ui.594249700590"),
        waiting_for_user: tr("ui.059f99450f1c"),
        succeeded: tr("ui.51991a5d111a"),
        failed: tr("ui.3e3c8068bb0e"),
        skipped: tr("ui.9f38afd41e89"),
        canceled: tr("ui.a5ffdc95eeb0")
    }[status];
}
function formatValue(value: unknown): string {
    const serialized = JSON.stringify(value, null, 2);
    return serialized && serialized.length > 4000
        ? `${serialized.slice(0, 4000)}\n...`
        : serialized ?? String(value);
}
function workflowArtifact(run: DesktopWorkflowRun | null): {
    fileName: string;
    savedPath: string;
} | null {
    if (run?.status !== "succeeded")
        return null;
    const exportNode = [...run.nodeRuns].reverse().find((node) => node.executorKey === "local.data.csv_export" &&
        node.status === "succeeded");
    if (!exportNode?.output ||
        typeof exportNode.output !== "object" ||
        Array.isArray(exportNode.output)) {
        return null;
    }
    const output = exportNode.output as {
        fileName?: unknown;
        savedPath?: unknown;
    };
    return typeof output.fileName === "string" &&
        typeof output.savedPath === "string"
        ? { fileName: output.fileName, savedPath: output.savedPath }
        : null;
}
