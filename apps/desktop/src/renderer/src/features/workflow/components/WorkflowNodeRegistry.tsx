import { tr } from "../../../i18n";
import { Workflow } from "lucide-react";
import type { WorkflowPageModel } from "../types";
export function WorkflowNodeRegistry({ registry, definitions }: {
    registry: WorkflowPageModel["registry"];
    definitions: WorkflowPageModel["visibleDefinitions"];
}) {
    return (<>
      <div className="workflow-registry-meta">
        <span>{registry?.definitions.length ?? 0}{tr("ui.df2dd979aa20")}</span>
        <span>
          {registry?.definitions.filter((item) => item.available).length ?? 0}{tr("ui.cc1b71dab699")}</span>
        <code>{registry?.revisionHash.slice(0, 19) ?? tr("ui.1d08846f05c5")}</code>
      </div>
      <div className="workflow-node-grid">
        {definitions.map((definition) => (<article key={definition.executorKey} className={!definition.available ? "blocked" : ""}>
            <div className="workflow-node-card-head">
              <span className={`workflow-node-source ${definition.source}`}>
                {definition.source === "desktop_builtin" ? "BUILT-IN" : "EXTENSION"}
              </span>
              <span className={definition.available ? "available" : "unavailable"}>
                {definition.available ? tr("ui.e91365cf9ed9") : tr("ui.a00db105bd49")}
              </span>
            </div>
            <h3>{definition.title}</h3>
            <code>{definition.executorKey}</code>
            <p>{definition.description}</p>
            <div className="workflow-node-tags">
              <span>{definition.executionTarget}</span>
              <span>{definition.portability}</span>
              <span>v{definition.definitionVersion}</span>
            </div>
            {!definition.available && <small>{definition.blockedReason}</small>}
          </article>))}
        {registry && definitions.length === 0 && (<div className="workflow-registry-empty">
            <Workflow size={26}/>
            <span>{tr("ui.1e6d03870e46")}</span>
          </div>)}
      </div>
    </>);
}
