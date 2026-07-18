import {
  File,
  FileText,
  FolderOpen,
  LoaderCircle,
  Play
} from "lucide-react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";

export function NativeConnectorsPanel({
  model,
  actions
}: {
  model: Pick<
    WorkflowPageModel,
    "connectors" | "connectorBusyId" | "selectedProjectId" | "selectedFilePath"
  >;
  actions: WorkflowPageActions["connectors"];
}) {
  return (
    <div className="native-connector-grid">
      {model.connectors.map((connector) => (
        <article
          key={connector.connectorId}
          className={!connector.available ? "unavailable" : ""}
        >
          <div className="native-connector-icon">
            {connector.connectorId === "vscode"
              ? <FileText size={22} />
              : connector.connectorId === "excel"
                ? <File size={22} />
                : <Play size={22} />}
          </div>
          <div className="native-connector-copy">
            <div>
              <h3>{connector.name}</h3>
              <span className={connector.available ? "available" : ""}>
                {connector.available ? "已检测" : "未安装"}
              </span>
            </div>
            <p>{connector.description}</p>
            <small>
              {connector.supportedExtensions.length
                ? connector.supportedExtensions.join(" · ")
                : "项目或任意项目文件"}
            </small>
          </div>
          <button
            type="button"
            disabled={
              !connector.available ||
              model.connectorBusyId !== null ||
              !model.selectedProjectId
            }
            onClick={() => actions.onOpen(connector)}
          >
            {model.connectorBusyId === connector.connectorId
              ? <LoaderCircle className="spin" size={14} />
              : <FolderOpen size={14} />}
            {connector.connectorId === "vscode"
              ? model.selectedFilePath ? "打开所选文件" : "打开项目"
              : "打开所选文件"}
          </button>
        </article>
      ))}
    </div>
  );
}
