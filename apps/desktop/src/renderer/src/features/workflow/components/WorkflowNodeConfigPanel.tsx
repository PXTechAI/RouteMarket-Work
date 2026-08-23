import "./workflow-node-config-panel.scss";
import { tr, type MessageKey } from "../../../i18n";
import { Code2, FolderOpen, ListChecks, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DesktopWorkflowDraftNode } from "../../../../../shared/desktop-api";
import type { WorkflowPageActions } from "../types";
import {
  normalizeWorkflowParameterSchema,
  resolveWorkflowParameterFields,
  validateWorkflowParameterConfig,
  withWorkflowParameterDefaults,
  workflowParameterType,
  type WorkflowParameterField,
} from "./workflow-node-config-schema";

type EditorMode = "form" | "json";

const FIELD_LABELS: Partial<Record<string, MessageKey>> = {
  url: "workflow.node.field.url",
  sourceUrl: "workflow.node.field.sourceUrl",
  selector: "workflow.node.field.selector",
  text: "workflow.node.field.text",
  relativePath: "workflow.node.field.relativePath",
  relativePaths: "workflow.node.field.relativePaths",
  query: "workflow.node.field.query",
  executable: "workflow.node.field.executable",
  args: "workflow.node.field.args",
  processId: "workflow.node.field.processId",
  expectedSha256: "workflow.node.field.expectedSha256",
  pageId: "workflow.node.field.pageId",
  titleSelectors: "workflow.node.field.titleSelectors",
  priceSelectors: "workflow.node.field.priceSelectors",
  screenshotsDirectory: "workflow.node.field.screenshotsDirectory",
  outputDirectory: "workflow.node.field.outputDirectory",
  fileName: "workflow.node.field.fileName",
  workbookPath: "workflow.node.field.workbookPath",
  sheetName: "workflow.node.field.sheetName",
  recipient: "workflow.node.field.recipient",
  subject: "workflow.node.field.subject",
  body: "workflow.node.field.body",
  intervalMinutes: "workflow.node.field.intervalMinutes",
  accelerator: "workflow.node.field.accelerator",
  message: "workflow.node.field.message",
  task: "workflow.node.field.task",
};

export function WorkflowNodeConfigPanel({ node, actions, onClose }: {
  node: DesktopWorkflowDraftNode;
  actions: WorkflowPageActions["canvas"];
  onClose(): void;
}) {
  const schema = useMemo(
    () => normalizeWorkflowParameterSchema(node.definitionSnapshot.inputSchema),
    [node.definitionSnapshot.inputSchema],
  );
  const [mode, setMode] = useState<EditorMode>("form");
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>(() =>
    withWorkflowParameterDefaults(schema, node.config),
  );
  const [rawConfig, setRawConfig] = useState(() => JSON.stringify(draftConfig, null, 2));
  const [error, setError] = useState<string | null>(null);
  const fields = useMemo(
    () => resolveWorkflowParameterFields(node.executorKey, schema, draftConfig),
    [draftConfig, node.executorKey, schema],
  );

  useEffect(() => {
    const next = withWorkflowParameterDefaults(schema, node.config);
    setMode("form");
    setDraftConfig(next);
    setRawConfig(JSON.stringify(next, null, 2));
    setError(null);
  }, [node.config, node.nodeId, schema]);

  function applyConfig() {
    try {
      const next = mode === "json" ? parseConfig(rawConfig) : draftConfig;
      const nextFields = resolveWorkflowParameterFields(node.executorKey, schema, next);
      const invalidKey = validateWorkflowParameterConfig(nextFields, next);
      if (invalidKey) throw new Error(tr("workflow.node.invalidField", [fieldLabel(invalidKey)]));
      actions.onUpdateNodeConfig(node.nodeId, next);
      setDraftConfig(next);
      setRawConfig(JSON.stringify(next, null, 2));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.c2f2761cc273"));
    }
  }

  function changeMode(nextMode: EditorMode) {
    if (nextMode === mode) return;
    if (nextMode === "json") {
      setRawConfig(JSON.stringify(draftConfig, null, 2));
      setMode(nextMode);
      setError(null);
      return;
    }
    try {
      const next = parseConfig(rawConfig);
      setDraftConfig(next);
      setMode(nextMode);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : tr("ui.c2f2761cc273"));
    }
  }

  function updateField(key: string, value: unknown) {
    setDraftConfig((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setError(null);
  }

  async function chooseDirectory(key: string) {
    const directory = await actions.onChooseOutputDirectory();
    if (directory) updateField(key, directory);
  }

  return (
    <section className="workflow-node-config-panel" aria-label={tr("workflow.node.details")}>
      <header>
        <span className="workflow-node-config-icon"><Settings2 size={15} /></span>
        <div>
          <strong>{node.title}</strong>
          <code>{node.executorKey}</code>
        </div>
        <button type="button" title={tr("ui.6c14bd7f6f9e")} aria-label={tr("ui.6c14bd7f6f9e")} onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <p className="workflow-node-config-description">{node.definitionSnapshot.description}</p>
      <div className="workflow-node-config-meta">
        <span>{node.executionTarget === "desktop" ? tr("ui.8b4c1c5f0c40") : node.executionTarget === "cloud" ? tr("ui.565481c9bea6") : tr("ui.4afad877551a")}</span>
        <span>{node.definitionSnapshot.portability}</span>
        <span>v{node.definitionSnapshot.definitionVersion}</span>
      </div>

      <div className="workflow-node-config-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "form"} className={mode === "form" ? "is-active" : ""} onClick={() => changeMode("form")}>
          <ListChecks size={14} />{tr("workflow.node.formMode")}
        </button>
        <button type="button" role="tab" aria-selected={mode === "json"} className={mode === "json" ? "is-active" : ""} onClick={() => changeMode("json")}>
          <Code2 size={14} />{tr("workflow.node.jsonMode")}
        </button>
      </div>

      {mode === "form" ? (
        <div className="workflow-node-config-form" role="tabpanel">
          {fields.length ? fields.map((field) => (
            <ParameterField
              key={field.key}
              field={field}
              value={draftConfig[field.key]}
              onChange={(value) => updateField(field.key, value)}
              onChooseDirectory={field.key === "outputDirectory" ? () => void chooseDirectory(field.key) : undefined}
            />
          )) : (
            <div className="workflow-node-config-empty">
              <ListChecks size={20} />
              <span>{tr("workflow.node.noParameters")}</span>
            </div>
          )}
        </div>
      ) : (
        <label className="workflow-node-config-editor" role="tabpanel">
          <span>{tr("ui.9127b34f7d60")}</span>
          <textarea value={rawConfig} spellCheck={false} onChange={(event) => setRawConfig(event.target.value)} />
        </label>
      )}

      {error && <p className="workflow-node-config-error">{error}</p>}
      <footer className="workflow-node-config-actions">
        <button type="button" onClick={applyConfig}>{tr("ui.47ef129b4b3d")}</button>
      </footer>
    </section>
  );
}

function ParameterField({ field, value, onChange, onChooseDirectory }: {
  field: WorkflowParameterField;
  value: unknown;
  onChange(value: unknown): void;
  onChooseDirectory?: () => void;
}) {
  const type = workflowParameterType(field.schema);
  const label = field.schema.title ?? fieldLabel(field.key);
  const id = `workflow-node-field-${field.key}`;
  return (
    <div className="workflow-node-config-field">
      <label htmlFor={id}>
        <span>{label}</span>
        {field.required && <em>{tr("workflow.node.required")}</em>}
      </label>
      {renderFieldControl({ field, id, type, value, onChange, onChooseDirectory })}
      {field.schema.description && <small>{field.schema.description}</small>}
      {type === "array" && <small>{tr("workflow.node.listHint")}</small>}
    </div>
  );
}

function renderFieldControl(input: {
  field: WorkflowParameterField;
  id: string;
  type: string;
  value: unknown;
  onChange(value: unknown): void;
  onChooseDirectory?: () => void;
}) {
  const { field, id, type, value, onChange, onChooseDirectory } = input;
  if (field.schema.enum?.length) {
    return (
      <select id={id} value={value === undefined ? "" : JSON.stringify(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : JSON.parse(event.target.value))}>
        {!field.required && <option value="">—</option>}
        {field.schema.enum.map((option) => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>)}
      </select>
    );
  }
  if (type === "boolean") {
    return (
      <label className="workflow-node-config-switch" htmlFor={id}>
        <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span />
      </label>
    );
  }
  if (type === "array") {
    const lines = Array.isArray(value) ? value.map(String).join("\n") : "";
    return <textarea id={id} value={lines} onChange={(event) => onChange(event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))} />;
  }
  if (type === "object") {
    return <div className="workflow-node-config-complex">{tr("workflow.node.advancedField")}</div>;
  }
  if (type === "number" || type === "integer") {
    return (
      <input
        id={id}
        type="number"
        step={type === "integer" ? 1 : "any"}
        min={field.schema.minimum}
        max={field.schema.maximum}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    );
  }

  const stringValue = typeof value === "string" ? value : "";
  const control = field.schema["x-ui"]?.control === "textarea"
    ? <textarea id={id} value={stringValue} maxLength={field.schema.maxLength} onChange={(event) => onChange(event.target.value)} />
    : <input id={id} type={field.schema.format === "email" ? "email" : field.schema.format === "uri" ? "url" : "text"} value={stringValue} maxLength={field.schema.maxLength} onChange={(event) => onChange(event.target.value)} />;

  return onChooseDirectory ? (
    <div className="workflow-node-config-path">
      {control}
      <button type="button" title={tr("ui.8395405a20ae")} aria-label={tr("ui.8395405a20ae")} onClick={onChooseDirectory}><FolderOpen size={15} /></button>
    </div>
  ) : control;
}

function parseConfig(rawConfig: string): Record<string, unknown> {
  const parsed = JSON.parse(rawConfig) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(tr("ui.f4fa2869a3fd"));
  }
  return parsed as Record<string, unknown>;
}

function fieldLabel(key: string): string {
  const messageKey = FIELD_LABELS[key];
  if (messageKey) return tr(messageKey);
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (value) => value.toUpperCase());
}
