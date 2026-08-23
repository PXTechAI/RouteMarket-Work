import "./native-connectors-panel.scss";
import { tr } from "../../../i18n";
import { File, FileText, FolderOpen, LoaderCircle, Play } from "lucide-react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
export function NativeConnectorsPanel({ model, actions }: {
    model: Pick<WorkflowPageModel, "connectors" | "connectorBusyId" | "selectedProjectId" | "selectedFilePath">;
    actions: WorkflowPageActions["connectors"];
}) {
    return (<div className="native-connector-grid">
      {model.connectors.map((connector) => (<article key={connector.connectorId} className={!connector.available ? "unavailable" : ""}>
          <div className="native-connector-icon">
            {connector.connectorId === "vscode"
                ? <FileText size={22}/>
                : connector.connectorId === "excel"
                    ? <File size={22}/>
                    : <Play size={22}/>}
          </div>
          <div className="native-connector-copy">
            <div>
              <h3>{connector.name}</h3>
              <span className={connector.available ? "available" : ""}>
                {connector.available ? tr("ui.44fea7b7f441") : tr("ui.6f7dc945aefa")}
              </span>
            </div>
            <p>{connector.description}</p>
            <small>
              {connector.supportedExtensions.length
                ? connector.supportedExtensions.join(" · ")
                : tr("ui.b06bc2f4a0a8")}
            </small>
          </div>
          <button type="button" disabled={!connector.available ||
                model.connectorBusyId !== null ||
                !model.selectedProjectId} onClick={() => actions.onOpen(connector)}>
            {model.connectorBusyId === connector.connectorId
                ? <LoaderCircle className="spin" size={14}/>
                : <FolderOpen size={14}/>}
            {connector.connectorId === "vscode"
                ? model.selectedFilePath ? tr("ui.ff0208112045") : tr("ui.90c96fb18e6e")
                : tr("ui.ff0208112045")}
          </button>
        </article>))}
    </div>);
}
