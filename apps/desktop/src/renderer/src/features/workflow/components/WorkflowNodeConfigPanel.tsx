import { FolderOpen, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesktopWorkflowDraftNode } from "../../../../../shared/desktop-api";
import type { WorkflowPageActions } from "../types";

export function WorkflowNodeConfigPanel({
  node,
  actions,
  onClose
}: {
  node: DesktopWorkflowDraftNode;
  actions: WorkflowPageActions["canvas"];
  onClose(): void;
}) {
  const [rawConfig, setRawConfig] = useState(() =>
    JSON.stringify(node.config, null, 2)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRawConfig(JSON.stringify(node.config, null, 2));
    setError(null);
  }, [node]);

  function applyConfig() {
    try {
      const parsed = JSON.parse(rawConfig) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("节点配置必须是 JSON 对象。");
      }
      actions.onUpdateNodeConfig(node.nodeId, parsed as Record<string, unknown>);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "节点配置无效。");
    }
  }

  async function chooseDirectory() {
    const directory = await actions.onChooseOutputDirectory();
    if (!directory) return;
    const config = { ...node.config, outputDirectory: directory };
    setRawConfig(JSON.stringify(config, null, 2));
    actions.onUpdateNodeConfig(node.nodeId, config);
  }

  return (
    <section className="workflow-node-config-panel">
      <div>
        <span className="workflow-node-config-icon"><Settings2 size={14} /></span>
        <div>
          <strong>{node.title}</strong>
          <code>{node.executorKey}</code>
        </div>
      </div>
      <label>
        <span>节点参数（JSON）</span>
        <textarea
          value={rawConfig}
          spellCheck={false}
          onChange={(event) => setRawConfig(event.target.value)}
        />
      </label>
      <div className="workflow-node-config-actions">
        {node.executorKey === "local.data.csv_export" && (
          <button type="button" onClick={() => void chooseDirectory()}>
            <FolderOpen size={12} />
            更换输出目录
          </button>
        )}
        <button type="button" onClick={applyConfig}>应用参数</button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
      {error && <p>{error}</p>}
    </section>
  );
}
