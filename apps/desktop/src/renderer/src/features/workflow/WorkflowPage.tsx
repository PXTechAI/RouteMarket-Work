import { tr } from "../../i18n";
import { CircleAlert, Search, X } from "lucide-react";
import { LocalTriggersPanel } from "./components/LocalTriggersPanel";
import { NativeConnectorsPanel } from "./components/NativeConnectorsPanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { WorkflowNodeRegistry } from "./components/WorkflowNodeRegistry";
import type { WorkflowPageProps, WorkflowPanel } from "./types";
function panelContent(): Record<WorkflowPanel, {
    title: string;
    description: string;
}> { return {
    canvas: {
        title: "Workflow Canvas",
        description: tr("ui.aae3260e653d")
    },
    nodes: {
        title: tr("ui.5bd6c3f75384"),
        description: tr("ui.24dcb452bd27")
    },
    triggers: {
        title: tr("ui.bab7876c60f8"),
        description: tr("ui.fd407c8da8a1")
    },
    connectors: {
        title: tr("ui.244747cf2f44"),
        description: tr("ui.b1ee498c9473")
    }
}; }
export function WorkflowPage({ model, actions }: WorkflowPageProps) {
    const content = panelContent()[model.panel];
    return (<section className="workflow-pane">
      <div className="workflow-registry-header">
        <div>
          <span className="eyebrow">Desktop Node Registry</span>
          <h2>{content.title}</h2>
          <p>{content.description}</p>
        </div>
        <div className="workflow-header-actions">
          <div className="workflow-panel-switch" role="tablist" aria-label={tr("ui.202fff00e85f")}>
            <PanelButton panel="canvas" current={model.panel} onSelect={actions.navigation.onPanelChange}>{tr("ui.95b2102fbb99")}</PanelButton>
            <PanelButton panel="nodes" current={model.panel} onSelect={actions.navigation.onPanelChange}>{tr("ui.e840cd6f1e21")}</PanelButton>
            <PanelButton panel="triggers" current={model.panel} onSelect={actions.navigation.onPanelChange}>{tr("ui.2d189a3f46a3")}</PanelButton>
            <PanelButton panel="connectors" current={model.panel} onSelect={actions.navigation.onPanelChange}>{tr("ui.c2dd0286598f")}</PanelButton>
          </div>
          {model.panel === "nodes" && (<label>
              <Search size={14}/>
              <input value={model.search} placeholder={tr("ui.361d307d1422")} onChange={(event) => actions.navigation.onSearchChange(event.target.value)}/>
            </label>)}
        </div>
      </div>

      {model.panel === "canvas" && (<WorkflowCanvas model={model} actions={actions.canvas}/>)}
      {model.panel === "nodes" && (<WorkflowNodeRegistry registry={model.registry} definitions={model.visibleDefinitions}/>)}
      {model.panel === "triggers" && (<LocalTriggersPanel model={model} actions={actions.triggers}/>)}
      {model.panel === "connectors" && (<NativeConnectorsPanel model={model} actions={actions.connectors}/>)}

      {model.error && (<div className="inline-error" role="alert">
          <CircleAlert size={18}/>
          <span>{model.error}</span>
          <button type="button" title={tr("ui.6c14bd7f6f9e")} onClick={actions.onDismissError}>
            <X size={14}/>
          </button>
        </div>)}
    </section>);
}
function PanelButton({ panel, current, onSelect, children }: {
    panel: WorkflowPanel;
    current: WorkflowPanel;
    onSelect(panel: WorkflowPanel): void;
    children: string;
}) {
    return (<button type="button" role="tab" aria-selected={current === panel} className={current === panel ? "active" : ""} onClick={() => onSelect(panel)}>
      {children}
    </button>);
}
