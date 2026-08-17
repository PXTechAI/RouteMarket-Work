import { tr } from "../../../i18n";
import { Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, SelectionMode, getBezierPath, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge, type EdgeProps, type EdgeTypes, type Node, type NodeChange, type NodeProps, type NodeTypes } from "@xyflow/react";
import { CopyPlus, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { DesktopWorkflowCloudPort, DesktopWorkflowDraft, DesktopWorkflowDraftNode, DesktopWorkflowNodeRunStatus, DesktopWorkflowRun } from "../../../../../shared/desktop-api";
import { WorkspaceState } from "../../../app/WorkspaceState";
import { canConnectWorkflowDraftPorts } from "../workflow-draft-graph";
type WorkflowFlowNodeData = Record<string, unknown> & {
    draftNode: DesktopWorkflowDraftNode;
    runStatus: DesktopWorkflowNodeRunStatus | null;
    onConfigure(nodeId: string): void;
    onRemove(nodeId: string): void;
};
type WorkflowFlowEdgeData = Record<string, unknown> & {
    onRemove(edgeId: string): void;
};
type WorkflowFlowNode = Node<WorkflowFlowNodeData, "desktopWorkflowNode">;
type WorkflowFlowEdge = Edge<WorkflowFlowEdgeData, "desktopWorkflowEdge">;
const nodeTypes = {
    desktopWorkflowNode: DesktopWorkflowNodeCard
} satisfies NodeTypes;
const edgeTypes = {
    desktopWorkflowEdge: DesktopWorkflowEdge
} satisfies EdgeTypes;
type DesktopWorkflowFlowProps = {
    draft: DesktopWorkflowDraft | null;
    selectedRun: DesktopWorkflowRun | null;
    busy: boolean;
    fitViewRevision: number;
    selectedNodeIds: string[];
    onSelectNodes(nodeIds: string[]): void;
    onConfigureNode(nodeId: string): void;
    onMoveNodes(positions: Array<{
        nodeId: string;
        x: number;
        y: number;
    }>): void;
    onConnectNodes(sourceNodeId: string, targetNodeId: string, sourcePortId?: string, targetPortId?: string): void;
    onRemoveNode(nodeId: string): void;
    onRemoveNodes(nodeIds: string[]): void;
    onDuplicateNodes(nodeIds: string[]): string[];
    onRemoveEdges(edgeIds: string[]): void;
};
export function DesktopWorkflowFlow(props: DesktopWorkflowFlowProps) {
    return (<ReactFlowProvider>
      <DesktopWorkflowFlowInner {...props}/>
    </ReactFlowProvider>);
}
function DesktopWorkflowFlowInner({ draft, selectedRun, busy, fitViewRevision, selectedNodeIds, onSelectNodes, onConfigureNode, onMoveNodes, onConnectNodes, onRemoveNode, onRemoveNodes, onDuplicateNodes, onRemoveEdges }: DesktopWorkflowFlowProps) {
    const mappedNodes = useMemo<WorkflowFlowNode[]>(() => (draft?.nodes ?? []).map((node) => ({
        id: node.nodeId,
        type: "desktopWorkflowNode",
        position: { x: node.x, y: node.y },
        selected: selectedNodeIds.includes(node.nodeId),
        data: {
            draftNode: node,
            runStatus: selectedRun?.nodeRuns.find((nodeRun) => nodeRun.nodeId === node.nodeId)
                ?.status ?? null,
            onConfigure: onConfigureNode,
            onRemove: onRemoveNode
        }
    })), [
        draft?.nodes,
        onConfigureNode,
        onRemoveNode,
        selectedNodeIds,
        selectedRun
    ]);
    const mappedEdges = useMemo<WorkflowFlowEdge[]>(() => (draft?.edges ?? []).map((edge) => ({
        id: edge.edgeId,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle: edge.sourcePortId ??
            defaultHandleId(draft?.nodes, edge.sourceNodeId, "output"),
        targetHandle: edge.targetPortId ??
            defaultHandleId(draft?.nodes, edge.targetNodeId, "input"),
        type: "desktopWorkflowEdge",
        markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--rm-accent)"
        },
        data: {
            onRemove: (edgeId) => onRemoveEdges([edgeId])
        }
    })), [draft?.edges, onRemoveEdges]);
    const [nodes, setNodes, onNodesChange] = useNodesState(mappedNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(mappedEdges);
    const { fitView } = useReactFlow<WorkflowFlowNode, WorkflowFlowEdge>();
    const nodeSetKey = (draft?.nodes ?? []).map((node) => node.nodeId).join(",");
    useEffect(() => setNodes(mappedNodes), [mappedNodes, setNodes]);
    useEffect(() => setEdges(mappedEdges), [mappedEdges, setEdges]);
    useEffect(() => {
        if (!draft)
            return;
        const animationFrame = requestAnimationFrame(() => {
            void fitView({ padding: 0.2, maxZoom: 1, duration: 180 });
        });
        return () => cancelAnimationFrame(animationFrame);
    }, [draft?.workflowId, fitView, nodeSetKey]);
    useEffect(() => {
        if (!fitViewRevision)
            return;
        const animationFrame = requestAnimationFrame(() => {
            void fitView({ padding: 0.2, maxZoom: 1, duration: 180 });
        });
        return () => cancelAnimationFrame(animationFrame);
    }, [fitView, fitViewRevision]);
    function handleNodesChange(changes: NodeChange<WorkflowFlowNode>[]) {
        onNodesChange(changes);
        const selectionChanges = changes.filter((change) => change.type === "select");
        if (selectionChanges.length) {
            const nextSelection = new Set(selectedNodeIds);
            for (const change of selectionChanges) {
                if (change.type !== "select")
                    continue;
                if (change.selected)
                    nextSelection.add(change.id);
                else
                    nextSelection.delete(change.id);
            }
            onSelectNodes([...nextSelection]);
        }
        const completedMoves = changes.flatMap((change) => change.type === "position" && change.dragging === false && change.position
            ? [{ nodeId: change.id, x: change.position.x, y: change.position.y }]
            : []);
        if (completedMoves.length)
            onMoveNodes(completedMoves);
    }
    function handleConnect(connection: Connection) {
        if (connection.source &&
            connection.target &&
            connection.source !== connection.target &&
            draft) {
            onConnectNodes(connection.source, connection.target, connection.sourceHandle ?? undefined, connection.targetHandle ?? undefined);
        }
    }
    return (<div className="desktop-workflow-flow" aria-label={tr("ui.3d5d596ddb23")}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} onConnect={handleConnect} onNodeClick={(event, node) => {
            const additive = "ctrlKey" in event &&
                (event.ctrlKey || event.metaKey || event.shiftKey);
            if (!additive) {
                onSelectNodes([node.id]);
                return;
            }
            onSelectNodes(selectedNodeIds.includes(node.id)
                ? selectedNodeIds.filter((nodeId) => nodeId !== node.id)
                : [...selectedNodeIds, node.id]);
        }} isValidConnection={(connection) => Boolean(draft &&
            connection.source &&
            connection.target &&
            canConnectWorkflowDraftPorts(draft, connection.source, connection.target, connection.sourceHandle, connection.targetHandle))} onNodesDelete={(deletedNodes) => onRemoveNodes(deletedNodes.map((node) => node.id))} onEdgesDelete={(deletedEdges) => onRemoveEdges(deletedEdges.map((edge) => edge.id))} nodesDraggable={!busy} nodesConnectable={!busy} elementsSelectable={!busy} selectionOnDrag={!busy} selectionMode={SelectionMode.Partial} panOnDrag={[1, 2]} multiSelectionKeyCode={["Meta", "Control", "Shift"]} deleteKeyCode={["Backspace", "Delete"]} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.2} maxZoom={2.5} proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: "desktopWorkflowEdge" }}>
        <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor="var(--rm-accent-soft)" nodeStrokeColor="var(--rm-accent)" maskColor="color-mix(in srgb, var(--rm-bg) 72%, transparent)"/>
        <Controls showInteractive={false}/>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--rm-border-strong)"/>
      </ReactFlow>
      {selectedNodeIds.length > 0 && (<div className="desktop-workflow-selection-actions">
          <span>{tr("ui.743aaf951e5d")}{selectedNodeIds.length}{tr("ui.df2dd979aa20")}</span>
          <button type="button" title={tr("ui.e3b983a5f113")} onClick={() => onSelectNodes(onDuplicateNodes(selectedNodeIds))}>
            <CopyPlus size={12}/>{tr("ui.4edd1d00875d")}</button>
          <button type="button" className="danger" onClick={() => {
                onRemoveNodes(selectedNodeIds);
                onSelectNodes([]);
            }}>
            <Trash2 size={12}/>{tr("ui.5d071a7a421e")}</button>
        </div>)}
      {!busy && draft?.nodes.length === 0 && (<div className="desktop-workflow-flow-empty">
          <WorkspaceState kind="empty" compact icon={<Settings2 size={24}/>} title={tr("ui.6d102c29f669")} description={tr("ui.752308120ca1")}/>
        </div>)}
      {busy && (<div className="desktop-workflow-flow-empty">
          <WorkspaceState kind="loading" compact title={tr("ui.55608dd8aa80")}/>
        </div>)}
    </div>);
}
function DesktopWorkflowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>) {
    const { draftNode, runStatus, onConfigure, onRemove } = data;
    const runtime = draftNode.definitionSnapshot.cloudRuntime;
    const inputPorts = runtime?.inputPorts ?? [defaultPort("input")];
    const outputPorts = runtime?.outputPorts ?? [defaultPort("output")];
    const portRows = Math.max(inputPorts.length, outputPorts.length, 1);
    return (<article className={[
            "desktop-workflow-node",
            selected ? "selected" : "",
            runStatus ?? ""
        ].filter(Boolean).join(" ")} style={{ minHeight: Math.max(146, 128 + portRows * 18) }}>
      {inputPorts.map((port, index) => (<WorkflowPort key={port.id} port={port} direction="input" index={index}/>))}
      <header>
        <span className={`desktop-workflow-target ${draftNode.executionTarget}`}>
          {executionTargetLabel(draftNode.executionTarget)}
        </span>
        <div className="desktop-workflow-node-actions nodrag">
          <button type="button" title={tr("ui.59fbb640e183")} onClick={(event) => {
            event.stopPropagation();
            onConfigure(draftNode.nodeId);
        }}>
            <Settings2 size={12}/>
          </button>
          <button type="button" title={tr("ui.ff37dc39f935")} onClick={(event) => {
            event.stopPropagation();
            onRemove(draftNode.nodeId);
        }}>
            <Trash2 size={12}/>
          </button>
        </div>
      </header>
      <strong>{draftNode.title}</strong>
      <code>{draftNode.executorKey}</code>
      <footer>
        <span>{draftNode.definitionSnapshot.portability}</span>
        <span>v{draftNode.definitionSnapshot.definitionVersion}</span>
      </footer>
      {outputPorts.map((port, index) => (<WorkflowPort key={port.id} port={port} direction="output" index={index}/>))}
    </article>);
}
function WorkflowPort({ port, direction, index }: {
    port: DesktopWorkflowCloudPort;
    direction: "input" | "output";
    index: number;
}) {
    const types = direction === "input" ? port.accepts : port.produces;
    const label = port.label ?? port.id;
    const title = `${label}${types?.length ? ` · ${types.join(" | ")}` : ""}`;
    const top = 102 + index * 18;
    return (<>
      <Handle id={port.id} type={direction === "input" ? "target" : "source"} position={direction === "input" ? Position.Left : Position.Right} className="desktop-workflow-handle" style={{ top }} title={title}/>
      <span className={`desktop-workflow-port-label ${direction}`} style={{ top }} title={title}>
        {label}
      </span>
    </>);
}
function defaultPort(direction: "input" | "output"): DesktopWorkflowCloudPort {
    return {
        id: direction,
        label: direction === "input" ? tr("ui.e8850440f247") : tr("ui.ded698ae1e7e"),
        [direction === "input" ? "accepts" : "produces"]: ["*"]
    };
}
function defaultHandleId(nodes: DesktopWorkflowDraftNode[] | undefined, nodeId: string, direction: "input" | "output"): string | undefined {
    const runtime = nodes?.find((node) => node.nodeId === nodeId)
        ?.definitionSnapshot.cloudRuntime;
    if (!runtime)
        return direction;
    const ports = direction === "input" ? runtime.inputPorts : runtime.outputPorts;
    return ports[0]?.id;
}
function DesktopWorkflowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }: EdgeProps<WorkflowFlowEdge>) {
    const [path, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition
    });
    return (<>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={selected ? "desktop-workflow-edge selected" : "desktop-workflow-edge"}/>
      <EdgeLabelRenderer>
        <button type="button" className={`desktop-workflow-edge-delete nodrag nopan ${selected ? "visible" : ""}`} title={tr("ui.0a7114b57732")} aria-label={tr("ui.0a7114b57732")} style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
        }} onClick={(event) => {
            event.stopPropagation();
            data?.onRemove(id);
        }}>
          <X size={11}/>
        </button>
      </EdgeLabelRenderer>
    </>);
}
function executionTargetLabel(target: DesktopWorkflowDraftNode["executionTarget"]): string {
    if (target === "desktop")
        return tr("ui.8b4c1c5f0c40");
    if (target === "cloud")
        return tr("ui.565481c9bea6");
    return tr("ui.4afad877551a");
}
