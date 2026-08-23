import type {
  DesktopWorkflowDraft,
  DesktopWorkflowDraftSummary,
  DesktopWorkflowRun,
  DesktopWorkflowNodeDefinition,
  DesktopWorkflowNodeRegistry,
  LocalTriggerKind,
  LocalTriggerSummary,
  NativeAppConnectorSummary
} from "../../../../shared/desktop-api";

export type WorkflowPanel = "canvas" | "nodes" | "triggers" | "connectors";

export type WorkflowPageModel = {
  panel: WorkflowPanel;
  registry: DesktopWorkflowNodeRegistry | null;
  search: string;
  visibleDefinitions: DesktopWorkflowNodeDefinition[];
  draft: DesktopWorkflowDraft | null;
  drafts: DesktopWorkflowDraftSummary[];
  draftDirty: boolean;
  draftBusy: boolean;
  canUndoDraft: boolean;
  canRedoDraft: boolean;
  fitViewRevision: number;
  runs: DesktopWorkflowRun[];
  selectedRun: DesktopWorkflowRun | null;
  runInput: string;
  runBusy: boolean;
  addExecutor: string;
  selectedProjectId: string | null;
  selectedFilePath: string | null;
  triggers: LocalTriggerSummary[];
  triggerName: string;
  triggerKind: LocalTriggerKind;
  triggerValue: string;
  triggerBusy: boolean;
  connectors: NativeAppConnectorSummary[];
  connectorBusyId: string | null;
  error: string | null;
};

export type WorkflowPageActions = {
  navigation: {
    onPanelChange(panel: WorkflowPanel): void;
    onSearchChange(value: string): void;
  };
  canvas: {
    onSelectDraft(workflowId: string): void;
    onCreateDraft(kind: DesktopWorkflowDraft["kind"]): void;
    onDraftNameChange(value: string): void;
    onUndoDraft(): void;
    onRedoDraft(): void;
    onAddExecutorChange(value: string): void;
    onAddNode(options?: {
      executorKey?: string;
      position?: { x: number; y: number };
    }): string | null;
    onMoveNodes(
      positions: Array<{ nodeId: string; x: number; y: number }>
    ): void;
    onConnectNodes(
      sourceNodeId: string,
      targetNodeId: string,
      sourcePortId?: string,
      targetPortId?: string
    ): void;
    onRemoveEdges(edgeIds: string[]): void;
    onClearEdges(): void;
    onRemoveNode(nodeId: string): void;
    onRemoveNodes(nodeIds: string[]): void;
    onDuplicateNodes(nodeIds: string[]): string[];
    onAutoLayout(): void;
    onUpdateNodeConfig(nodeId: string, config: Record<string, unknown>): void;
    onChooseOutputDirectory(): Promise<string | null>;
    onCreateWorkflowSkill(
      skillId: string,
      values: Record<string, string>
    ): void;
    onSaveDraft(): void;
    onDeleteDraft(): void;
    onRunInputChange(value: string): void;
    onRun(): void;
    onCancelRun(): void;
    onResumeRun(): void;
    onRetryRun(): void;
    onOpenRunArtifact(action: "open" | "reveal"): void;
  };
  triggers: {
    onNameChange(value: string): void;
    onKindChange(kind: LocalTriggerKind): void;
    onValueChange(value: string): void;
    onCreate(): void;
    onToggle(trigger: LocalTriggerSummary): void;
    onFire(triggerId: string): void;
    onRemove(triggerId: string): void;
  };
  connectors: {
    onOpen(connector: NativeAppConnectorSummary): void;
  };
  onDismissError(): void;
};

export type WorkflowPageProps = {
  model: WorkflowPageModel;
  actions: WorkflowPageActions;
};
