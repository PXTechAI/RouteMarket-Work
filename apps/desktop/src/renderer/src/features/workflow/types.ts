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
  runs: DesktopWorkflowRun[];
  selectedRun: DesktopWorkflowRun | null;
  runInput: string;
  runBusy: boolean;
  addExecutor: string;
  edgeSource: string;
  edgeTarget: string;
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
    onAddExecutorChange(value: string): void;
    onAddNode(): void;
    onEdgeSourceChange(value: string): void;
    onEdgeTargetChange(value: string): void;
    onConnectNodes(): void;
    onClearEdges(): void;
    onRemoveNode(nodeId: string): void;
    onUpdateNodeConfig(nodeId: string, config: Record<string, unknown>): void;
    onChooseOutputDirectory(): Promise<string | null>;
    onCreateAmazonPriceWorkflow(input: {
      url: string;
      outputDirectory: string;
      fileName: string;
    }): void;
    onSaveDraft(): void;
    onDeleteDraft(): void;
    onRunInputChange(value: string): void;
    onRun(): void;
    onCancelRun(): void;
    onRetryRun(): void;
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
