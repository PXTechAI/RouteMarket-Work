import { tr } from "../../../i18n";
import { FolderOpen, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesktopWorkflowDraftNode } from "../../../../../shared/desktop-api";
import type { WorkflowPageActions } from "../types";
export function WorkflowNodeConfigPanel({ node, actions, onClose }: {
    node: DesktopWorkflowDraftNode;
    actions: WorkflowPageActions["canvas"];
    onClose(): void;
}) {
    const [rawConfig, setRawConfig] = useState(() => JSON.stringify(node.config, null, 2));
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        setRawConfig(JSON.stringify(node.config, null, 2));
        setError(null);
    }, [node]);
    function applyConfig() {
        try {
            const parsed = JSON.parse(rawConfig) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error(tr("ui.f4fa2869a3fd"));
            }
            actions.onUpdateNodeConfig(node.nodeId, parsed as Record<string, unknown>);
            setError(null);
        }
        catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : tr("ui.c2f2761cc273"));
        }
    }
    async function chooseDirectory() {
        const directory = await actions.onChooseOutputDirectory();
        if (!directory)
            return;
        const config = { ...node.config, outputDirectory: directory };
        setRawConfig(JSON.stringify(config, null, 2));
        actions.onUpdateNodeConfig(node.nodeId, config);
    }
    return (<section className="workflow-node-config-panel">
      <div>
        <span className="workflow-node-config-icon"><Settings2 size={14}/></span>
        <div>
          <strong>{node.title}</strong>
          <code>{node.executorKey}</code>
        </div>
      </div>
      <label>
        <span>{tr("ui.9127b34f7d60")}</span>
        <textarea value={rawConfig} spellCheck={false} onChange={(event) => setRawConfig(event.target.value)}/>
      </label>
      <div className="workflow-node-config-actions">
        {node.executorKey === "local.data.csv_export" && (<button type="button" onClick={() => void chooseDirectory()}>
            <FolderOpen size={12}/>{tr("ui.8395405a20ae")}</button>)}
        <button type="button" onClick={applyConfig}>{tr("ui.47ef129b4b3d")}</button>
        <button type="button" onClick={onClose}>{tr("ui.6c14bd7f6f9e")}</button>
      </div>
      {error && <p>{error}</p>}
    </section>);
}
