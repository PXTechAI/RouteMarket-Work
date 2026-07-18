import { CircleAlert, Search, X } from "lucide-react";
import { LocalTriggersPanel } from "./components/LocalTriggersPanel";
import { NativeConnectorsPanel } from "./components/NativeConnectorsPanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { WorkflowNodeRegistry } from "./components/WorkflowNodeRegistry";
import type { WorkflowPageProps, WorkflowPanel } from "./types";

const panelContent: Record<WorkflowPanel, { title: string; description: string }> = {
  canvas: {
    title: "Workflow Canvas",
    description:
      "编辑本地草稿与定义快照；桌面节点可在本机运行，混合工作流仍由 RouteLab Orchestrator 协调。"
  },
  nodes: {
    title: "混合工作流节点",
    description:
      "云端 Orchestrator 保存运行事实；这里展示当前设备可提供的节点定义与可移植性。"
  },
  triggers: {
    title: "本地触发器",
    description:
      "在当前设备持续监听项目事件；触发记录进入 Activity，接入 Workflow Trigger API 后可直接派发运行。"
  },
  connectors: {
    title: "本地软件连接器",
    description:
      "优先使用软件原生启动接口打开项目内容；每次调用均受项目边界和本机审批保护。"
  }
};

export function WorkflowPage({ model, actions }: WorkflowPageProps) {
  const content = panelContent[model.panel];

  return (
    <section className="workflow-pane">
      <div className="workflow-registry-header">
        <div>
          <span className="eyebrow">Desktop Node Registry</span>
          <h2>{content.title}</h2>
          <p>{content.description}</p>
        </div>
        <div className="workflow-header-actions">
          <div className="workflow-panel-switch" role="tablist" aria-label="工作流视图">
            <PanelButton panel="canvas" current={model.panel} onSelect={actions.navigation.onPanelChange}>
              画布
            </PanelButton>
            <PanelButton panel="nodes" current={model.panel} onSelect={actions.navigation.onPanelChange}>
              节点
            </PanelButton>
            <PanelButton panel="triggers" current={model.panel} onSelect={actions.navigation.onPanelChange}>
              触发器
            </PanelButton>
            <PanelButton panel="connectors" current={model.panel} onSelect={actions.navigation.onPanelChange}>
              连接器
            </PanelButton>
          </div>
          {model.panel === "nodes" && (
            <label>
              <Search size={14} />
              <input
                value={model.search}
                placeholder="搜索节点或 executor key"
                onChange={(event) => actions.navigation.onSearchChange(event.target.value)}
              />
            </label>
          )}
        </div>
      </div>

      {model.panel === "canvas" && (
        <WorkflowCanvas model={model} actions={actions.canvas} />
      )}
      {model.panel === "nodes" && (
        <WorkflowNodeRegistry
          registry={model.registry}
          definitions={model.visibleDefinitions}
        />
      )}
      {model.panel === "triggers" && (
        <LocalTriggersPanel model={model} actions={actions.triggers} />
      )}
      {model.panel === "connectors" && (
        <NativeConnectorsPanel model={model} actions={actions.connectors} />
      )}

      {model.error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={18} />
          <span>{model.error}</span>
          <button type="button" title="关闭" onClick={actions.onDismissError}>
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

function PanelButton({
  panel,
  current,
  onSelect,
  children
}: {
  panel: WorkflowPanel;
  current: WorkflowPanel;
  onSelect(panel: WorkflowPanel): void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={current === panel}
      className={current === panel ? "active" : ""}
      onClick={() => onSelect(panel)}
    >
      {children}
    </button>
  );
}
