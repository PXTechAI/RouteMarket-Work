import { tr } from "../../i18n";
import type { DesktopWorkflowCloudPort, DesktopWorkflowDraft, DesktopWorkflowDraftNode } from "../../../../shared/desktop-api";
export function moveWorkflowDraftNode(draft: DesktopWorkflowDraft, nodeId: string, x: number, y: number): DesktopWorkflowDraft {
    return moveWorkflowDraftNodes(draft, [{ nodeId, x, y }]);
}
export function moveWorkflowDraftNodes(draft: DesktopWorkflowDraft, positions: Array<{
    nodeId: string;
    x: number;
    y: number;
}>): DesktopWorkflowDraft {
    const nextPositions = new Map(positions.map(({ nodeId, x, y }) => [
        nodeId,
        { x: boundedCoordinate(x), y: boundedCoordinate(y) }
    ]));
    const changed = draft.nodes.some((node) => {
        const position = nextPositions.get(node.nodeId);
        return position && (position.x !== node.x || position.y !== node.y);
    });
    if (!changed)
        return draft;
    return {
        ...draft,
        nodes: draft.nodes.map((node) => nextPositions.has(node.nodeId)
            ? { ...node, ...nextPositions.get(node.nodeId)! }
            : node)
    };
}
export function connectWorkflowDraftNodes(draft: DesktopWorkflowDraft, sourceNodeId: string, targetNodeId: string, edgeId: string, sourcePortId?: string, targetPortId?: string): DesktopWorkflowDraft {
    const connection = resolveWorkflowDraftConnection(draft, sourceNodeId, targetNodeId, sourcePortId, targetPortId);
    if (!connection ||
        wouldCreateWorkflowCycle(draft, sourceNodeId, targetNodeId)) {
        return draft;
    }
    if (hasDuplicateWorkflowConnection(draft, sourceNodeId, targetNodeId, connection)) {
        return draft;
    }
    return {
        ...draft,
        edges: [
            ...draft.edges,
            {
                edgeId,
                sourceNodeId,
                targetNodeId,
                sourcePortId: connection.sourcePortId,
                targetPortId: connection.targetPortId
            }
        ]
    };
}
export function canConnectWorkflowDraftPorts(draft: DesktopWorkflowDraft, sourceNodeId: string, targetNodeId: string, sourcePortId?: string | null, targetPortId?: string | null): boolean {
    if (wouldCreateWorkflowCycle(draft, sourceNodeId, targetNodeId))
        return false;
    const connection = resolveWorkflowDraftConnection(draft, sourceNodeId, targetNodeId, sourcePortId ?? undefined, targetPortId ?? undefined);
    return Boolean(connection &&
        !hasDuplicateWorkflowConnection(draft, sourceNodeId, targetNodeId, connection));
}
export type WorkflowDraftGraphIssue = {
    code: "cycle" | "node_unavailable" | "required_input";
    level: "error" | "warning";
    message: string;
    nodeId?: string;
};
export function validateWorkflowDraftGraph(draft: DesktopWorkflowDraft): WorkflowDraftGraphIssue[] {
    const issues: WorkflowDraftGraphIssue[] = [];
    if (workflowDraftHasCycle(draft)) {
        issues.push({
            code: "cycle",
            level: "error",
            message: tr("ui.6a5a864b0ca3")
        });
    }
    for (const node of draft.nodes) {
        if (!node.definitionSnapshot.available) {
            issues.push({
                code: "node_unavailable",
                level: "error",
                nodeId: node.nodeId,
                message: tr("ui.91fe4b953c59", [node.title, node.definitionSnapshot.blockedReason
                        ? `：${node.definitionSnapshot.blockedReason}`
                        : "。"])
            });
        }
        const inputPorts = node.definitionSnapshot.cloudRuntime?.inputPorts ?? [];
        for (const port of inputPorts) {
            if (port.required &&
                !draft.edges.some((edge) => edge.targetNodeId === node.nodeId &&
                    (edge.targetPortId ?? inputPorts[0]?.id) === port.id)) {
                issues.push({
                    code: "required_input",
                    level: "warning",
                    nodeId: node.nodeId,
                    message: tr("ui.b312dda94e0f", [node.title, port.label ?? port.id])
                });
            }
        }
    }
    return issues;
}
export function removeWorkflowDraftEdges(draft: DesktopWorkflowDraft, edgeIds: string[]): DesktopWorkflowDraft {
    const ids = new Set(edgeIds);
    if (!ids.size || !draft.edges.some((edge) => ids.has(edge.edgeId)))
        return draft;
    return {
        ...draft,
        edges: draft.edges.filter((edge) => !ids.has(edge.edgeId))
    };
}
export function removeWorkflowDraftNodes(draft: DesktopWorkflowDraft, nodeIds: string[]): DesktopWorkflowDraft {
    const ids = new Set(nodeIds);
    if (!ids.size || !draft.nodes.some((node) => ids.has(node.nodeId)))
        return draft;
    return {
        ...draft,
        nodes: draft.nodes.filter((node) => !ids.has(node.nodeId)),
        edges: draft.edges.filter((edge) => !ids.has(edge.sourceNodeId) && !ids.has(edge.targetNodeId))
    };
}
export function duplicateWorkflowDraftNodes(draft: DesktopWorkflowDraft, nodeIds: string[], createId: (kind: "node" | "edge", originalId: string) => string): {
    draft: DesktopWorkflowDraft;
    nodeIds: string[];
} {
    const selectedIds = new Set(nodeIds);
    const selectedNodes = draft.nodes.filter((node) => selectedIds.has(node.nodeId));
    if (!selectedNodes.length)
        return { draft, nodeIds: [] };
    const idMap = new Map(selectedNodes.map((node) => [node.nodeId, createId("node", node.nodeId)]));
    const duplicatedNodes = selectedNodes.map((node) => ({
        ...node,
        nodeId: idMap.get(node.nodeId)!,
        x: boundedCoordinate(node.x + 40),
        y: boundedCoordinate(node.y + 40),
        config: structuredClone(node.config)
    }));
    const duplicatedEdges = draft.edges
        .filter((edge) => selectedIds.has(edge.sourceNodeId) && selectedIds.has(edge.targetNodeId))
        .map((edge) => ({
        ...edge,
        edgeId: createId("edge", edge.edgeId),
        sourceNodeId: idMap.get(edge.sourceNodeId)!,
        targetNodeId: idMap.get(edge.targetNodeId)!
    }));
    return {
        draft: {
            ...draft,
            nodes: [...draft.nodes, ...duplicatedNodes],
            edges: [...draft.edges, ...duplicatedEdges]
        },
        nodeIds: duplicatedNodes.map((node) => node.nodeId)
    };
}
export function layoutWorkflowDraft(draft: DesktopWorkflowDraft): DesktopWorkflowDraft {
    if (draft.nodes.length < 2)
        return draft;
    const nodeIds = new Set(draft.nodes.map((node) => node.nodeId));
    const indegree = new Map(draft.nodes.map((node) => [node.nodeId, 0]));
    const outgoing = new Map(draft.nodes.map((node) => [node.nodeId, [] as string[]]));
    let validEdgeCount = 0;
    for (const edge of draft.edges) {
        if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId))
            continue;
        validEdgeCount += 1;
        indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
        outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }
    if (validEdgeCount === 0) {
        const nodes = draft.nodes.map((node, index) => ({
            ...node,
            x: 64 + (index % 3) * 280,
            y: 64 + Math.floor(index / 3) * 190
        }));
        if (nodes.every((node, index) => node.x === draft.nodes[index]?.x && node.y === draft.nodes[index]?.y)) {
            return draft;
        }
        return { ...draft, nodes };
    }
    const ranks = new Map<string, number>();
    const queue = draft.nodes
        .filter((node) => indegree.get(node.nodeId) === 0)
        .map((node) => node.nodeId);
    for (const nodeId of queue)
        ranks.set(nodeId, 0);
    for (let index = 0; index < queue.length; index += 1) {
        const nodeId = queue[index]!;
        const rank = ranks.get(nodeId) ?? 0;
        for (const targetId of outgoing.get(nodeId) ?? []) {
            ranks.set(targetId, Math.max(ranks.get(targetId) ?? 0, rank + 1));
            const nextIndegree = (indegree.get(targetId) ?? 1) - 1;
            indegree.set(targetId, nextIndegree);
            if (nextIndegree === 0)
                queue.push(targetId);
        }
    }
    const fallbackRank = Math.max(0, ...ranks.values()) + 1;
    for (const node of draft.nodes) {
        if (!ranks.has(node.nodeId))
            ranks.set(node.nodeId, fallbackRank);
    }
    const rankOffsets = new Map<number, number>();
    const nodes = draft.nodes.map((node) => {
        const rank = ranks.get(node.nodeId) ?? 0;
        const row = rankOffsets.get(rank) ?? 0;
        rankOffsets.set(rank, row + 1);
        return { ...node, x: 64 + rank * 280, y: 64 + row * 190 };
    });
    if (nodes.every((node, index) => node.x === draft.nodes[index]?.x && node.y === draft.nodes[index]?.y)) {
        return draft;
    }
    return { ...draft, nodes };
}
function boundedCoordinate(value: number): number {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(-10000, Math.min(10000, Math.round(value)));
}
function resolveWorkflowDraftConnection(draft: DesktopWorkflowDraft, sourceNodeId: string, targetNodeId: string, sourcePortId?: string, targetPortId?: string): {
    sourcePortId: string;
    targetPortId: string;
} | null {
    if (sourceNodeId === targetNodeId)
        return null;
    const sourceNode = draft.nodes.find((node) => node.nodeId === sourceNodeId);
    const targetNode = draft.nodes.find((node) => node.nodeId === targetNodeId);
    if (!sourceNode || !targetNode)
        return null;
    const sourcePort = resolvePort(sourceNode, "output", sourcePortId);
    const targetPort = resolvePort(targetNode, "input", targetPortId);
    if (!sourcePort || !targetPort || !portsAreCompatible(sourcePort, targetPort)) {
        return null;
    }
    return { sourcePortId: sourcePort.id, targetPortId: targetPort.id };
}
function hasDuplicateWorkflowConnection(draft: DesktopWorkflowDraft, sourceNodeId: string, targetNodeId: string, connection: {
    sourcePortId: string;
    targetPortId: string;
}): boolean {
    return draft.edges.some((edge) => {
        if (edge.sourceNodeId !== sourceNodeId ||
            edge.targetNodeId !== targetNodeId) {
            return false;
        }
        const existing = resolveWorkflowDraftConnection(draft, edge.sourceNodeId, edge.targetNodeId, edge.sourcePortId, edge.targetPortId);
        return (existing?.sourcePortId === connection.sourcePortId &&
            existing.targetPortId === connection.targetPortId);
    });
}
function wouldCreateWorkflowCycle(draft: DesktopWorkflowDraft, sourceNodeId: string, targetNodeId: string): boolean {
    if (sourceNodeId === targetNodeId)
        return true;
    const outgoing = new Map<string, string[]>();
    for (const edge of draft.edges) {
        const targets = outgoing.get(edge.sourceNodeId) ?? [];
        targets.push(edge.targetNodeId);
        outgoing.set(edge.sourceNodeId, targets);
    }
    const pending = [targetNodeId];
    const visited = new Set<string>();
    while (pending.length) {
        const nodeId = pending.pop()!;
        if (nodeId === sourceNodeId)
            return true;
        if (visited.has(nodeId))
            continue;
        visited.add(nodeId);
        pending.push(...(outgoing.get(nodeId) ?? []));
    }
    return false;
}
function workflowDraftHasCycle(draft: DesktopWorkflowDraft): boolean {
    const indegree = new Map(draft.nodes.map((node) => [node.nodeId, 0]));
    const outgoing = new Map(draft.nodes.map((node) => [node.nodeId, [] as string[]]));
    for (const edge of draft.edges) {
        if (!indegree.has(edge.sourceNodeId) || !indegree.has(edge.targetNodeId))
            continue;
        indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
        outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }
    const pending = [...indegree.entries()]
        .filter(([, count]) => count === 0)
        .map(([nodeId]) => nodeId);
    let visited = 0;
    for (let index = 0; index < pending.length; index += 1) {
        const nodeId = pending[index]!;
        visited += 1;
        for (const targetId of outgoing.get(nodeId) ?? []) {
            const count = (indegree.get(targetId) ?? 1) - 1;
            indegree.set(targetId, count);
            if (count === 0)
                pending.push(targetId);
        }
    }
    return visited !== draft.nodes.length;
}
function resolvePort(node: DesktopWorkflowDraftNode, direction: "input" | "output", portId?: string): DesktopWorkflowCloudPort | null {
    const runtime = node.definitionSnapshot.cloudRuntime;
    if (!runtime) {
        const defaultId = direction;
        return !portId || portId === defaultId
            ? {
                id: defaultId,
                [direction === "input" ? "accepts" : "produces"]: ["*"]
            }
            : null;
    }
    const ports = direction === "input" ? runtime.inputPorts : runtime.outputPorts;
    const resolvedId = portId ?? ports[0]?.id;
    return ports.find((port) => port.id === resolvedId) ?? null;
}
function portsAreCompatible(source: DesktopWorkflowCloudPort, target: DesktopWorkflowCloudPort): boolean {
    const produces = source.produces ?? [];
    const accepts = target.accepts ?? [];
    if (!produces.length || !accepts.length)
        return true;
    if (produces.includes("*") ||
        produces.includes("any") ||
        accepts.includes("*") ||
        accepts.includes("any")) {
        return true;
    }
    return produces.some((type) => accepts.includes(type));
}
