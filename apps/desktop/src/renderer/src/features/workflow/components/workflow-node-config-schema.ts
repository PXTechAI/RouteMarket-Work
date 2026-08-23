export type WorkflowParameterSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  items?: WorkflowParameterSchema;
  properties?: Record<string, WorkflowParameterSchema>;
  required?: string[];
  "x-ui"?: {
    advanced?: boolean;
    control?: "textarea" | "string-list";
  };
};

export type WorkflowParameterField = {
  key: string;
  schema: WorkflowParameterSchema;
  required: boolean;
};

const NODE_FIELD_ORDER: Record<string, string[]> = {
  "local.fs.read": ["relativePath"],
  "local.fs.search": ["query"],
  "local.fs.write": ["relativePath", "text", "expectedSha256"],
  "local.fs.create": ["relativePath", "text"],
  "local.process.start": ["executable", "args"],
  "local.process.stop": ["processId"],
  "local.browser.navigate": ["url"],
  "local.browser.click": ["selector"],
  "local.browser.type": ["selector", "text"],
  "local.browser.upload": ["selector", "relativePaths"],
  "local.browser.extract": ["selector"],
  "local.browser.screenshot": [],
  "local.browser.product_extract": ["sourceUrl", "titleSelectors", "priceSelectors"],
  "local.browser.screenshot_save": ["screenshotsDirectory"],
  "local.data.csv_export": ["outputDirectory", "fileName"],
  "local.data.xlsx_append": ["workbookPath", "sheetName"],
  "local.browser.qq_mail_send": ["recipient", "subject", "body"],
  "desktop.trigger.file_changed": ["relativePath"],
  "desktop.trigger.folder_added": ["relativePath"],
  "desktop.trigger.schedule": ["intervalMinutes"],
  "desktop.trigger.hotkey": ["accelerator"],
  "control.approval": ["message"],
};

const LEGACY_REQUIRED_FIELDS: Record<string, string[]> = {
  "local.fs.read": ["relativePath"],
  "local.fs.search": ["query"],
  "local.fs.write": ["relativePath", "text", "expectedSha256"],
  "local.fs.create": ["relativePath", "text"],
  "local.process.start": ["executable", "args"],
  "local.process.stop": ["processId"],
  "local.browser.navigate": ["url"],
  "local.browser.click": ["selector"],
  "local.browser.type": ["selector", "text"],
  "local.browser.upload": ["selector", "relativePaths"],
  "local.browser.extract": ["selector"],
  "local.browser.product_extract": ["sourceUrl"],
  "local.browser.screenshot_save": ["screenshotsDirectory"],
  "local.data.csv_export": ["outputDirectory"],
  "local.data.xlsx_append": ["workbookPath"],
  "local.browser.qq_mail_send": ["recipient", "workbookPath"],
  "desktop.trigger.file_changed": ["relativePath"],
  "desktop.trigger.folder_added": ["relativePath"],
  "desktop.trigger.schedule": ["intervalMinutes"],
  "desktop.trigger.hotkey": ["accelerator"],
};

const UPSTREAM_OUTPUT_FIELDS = new Set([
  "productTitle",
  "priceText",
  "priceValue",
  "currency",
  "capturedAt",
  "screenshotPath",
]);

export function normalizeWorkflowParameterSchema(value: Record<string, unknown>): WorkflowParameterSchema {
  return value as WorkflowParameterSchema;
}

export function withWorkflowParameterDefaults(
  schema: WorkflowParameterSchema,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...config };
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (next[key] !== undefined) continue;
    if (property.const !== undefined) next[key] = property.const;
    else if (property.default !== undefined) next[key] = property.default;
  }
  return next;
}

export function resolveWorkflowParameterFields(
  executorKey: string,
  schema: WorkflowParameterSchema,
  config: Record<string, unknown>,
): WorkflowParameterField[] {
  const properties = schema.properties ?? {};
  const preferred = NODE_FIELD_ORDER[executorKey];
  const schemaRequired = new Set(schema.required ?? []);
  const legacyRequired = new Set(LEGACY_REQUIRED_FIELDS[executorKey] ?? []);
  const keys = preferred
    ? [...preferred, ...Object.keys(config).filter((key) => !preferred.includes(key))]
    : [...Object.keys(properties), ...Object.keys(config).filter((key) => !(key in properties))];

  return [...new Set(keys)]
    .filter((key) =>
      !key.startsWith("$")
      && !UPSTREAM_OUTPUT_FIELDS.has(key)
      && properties[key]?.const === undefined
      && properties[key]?.["x-ui"]?.advanced !== true
    )
    .map((key) => ({
      key,
      schema: properties[key] ?? inferWorkflowParameterSchema(key, config[key]),
      required: schemaRequired.has(key) || legacyRequired.has(key),
    }));
}

export function inferWorkflowParameterSchema(key: string, value: unknown): WorkflowParameterSchema {
  if (Array.isArray(value) || key.endsWith("Paths") || key.endsWith("Selectors") || key === "args") {
    return { type: "array", items: { type: "string" }, "x-ui": { control: "string-list" } };
  }
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number" || key.endsWith("Minutes")) return { type: "number" };
  if (key === "url" || key.endsWith("Url")) return { type: "string", format: "uri" };
  if (key === "recipient") return { type: "string", format: "email" };
  if (["text", "body", "task", "message"].includes(key)) {
    return { type: "string", "x-ui": { control: "textarea" } };
  }
  return { type: "string" };
}

export function workflowParameterType(schema: WorkflowParameterSchema): string {
  const type = Array.isArray(schema.type)
    ? schema.type.find((candidate) => candidate !== "null")
    : schema.type;
  if (type) return type;
  if (schema.enum?.length) return typeof schema.enum[0];
  return "string";
}

export function validateWorkflowParameterConfig(
  fields: WorkflowParameterField[],
  config: Record<string, unknown>,
): string | null {
  for (const field of fields) {
    const value = config[field.key];
    if (field.required && isEmptyParameter(value)) return field.key;
    if (isEmptyParameter(value)) continue;
    const type = workflowParameterType(field.schema);
    if (type === "number" || type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value)) return field.key;
      if (type === "integer" && !Number.isInteger(value)) return field.key;
      if (field.schema.minimum !== undefined && value < field.schema.minimum) return field.key;
      if (field.schema.maximum !== undefined && value > field.schema.maximum) return field.key;
    }
    if (type === "array" && !Array.isArray(value)) return field.key;
  }
  return null;
}

function isEmptyParameter(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}
