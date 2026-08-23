import { createHash } from "node:crypto";
import {
  assertPluginManifest,
  type PluginManifest
} from "@routemarket/work-protocol";

export type BuiltinPluginCatalog = {
  schemaVersion: 1;
  revisionHash: string;
  plugins: PluginManifest[];
};

export function buildBuiltinPluginCatalog(): BuiltinPluginCatalog {
  const plugins = BUILTIN_PLUGINS
    .map((plugin) => structuredClone(plugin))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const plugin of plugins) assertPluginManifest(plugin);
  assertUniqueContributions(plugins);
  return {
    schemaVersion: 1,
    revisionHash: hashCanonical(plugins),
    plugins
  };
}

export function findBuiltinPlugin(pluginId: string): PluginManifest | null {
  return buildBuiltinPluginCatalog().plugins.find((plugin) => plugin.id === pluginId) ?? null;
}

const BROWSER_PLUGIN = {
  schemaVersion: 1,
  id: "ai.routemarket.browser",
  name: "RouteMarket Browser",
  description: "Host-managed browser surfaces, isolated profiles, downloads and approved Agent interaction.",
  version: "0.2.0",
  publisher: "PXTechAI",
  kind: "host_runtime",
  status: "available",
  distribution: { source: "bundled", packageFormat: "declarative" },
  engines: { routemarketWork: "^0.2.0" },
  permissions: ["project.read", "project.write", "browser.read", "browser.interact"],
  activationEvents: ["onPage:browser", "onTool:browser_get_state"],
  contributes: {
    viewers: [],
    tools: [
      tool("browser_get_state", "Inspect browser", "Inspect pages in the project browser.", "local.browser.read", "R0"),
      tool("browser_request_user_login", "Request user login", "Hand the Managed Browser to the user for secure sign-in without exposing credentials to the Agent.", "local.browser.takeover", "R0"),
      tool("browser_page_create", "Create browser page", "Create a page in the managed browser.", "local.browser.navigate", "R1"),
      tool("browser_navigate", "Navigate browser", "Navigate an Agent-controlled page.", "local.browser.navigate", "R1"),
      tool("browser_click", "Click browser element", "Click an element after local approval.", "local.browser.click", "R2"),
      tool("browser_click_ref", "Click referenced browser element", "Click a recently inspected element, including open Shadow DOM and same-origin frames.", "local.browser.click", "R2"),
      tool("browser_click_at", "Click browser coordinates", "Click visible page coordinates after local approval.", "local.browser.click", "R2"),
      tool("browser_scroll", "Scroll browser page", "Scroll the visible page after local approval.", "local.browser.click", "R2"),
      tool("browser_press", "Press browser key", "Send a keyboard event after local approval.", "local.browser.type", "R2"),
      tool("browser_type", "Type in browser", "Enter text after local approval.", "local.browser.type", "R2"),
      tool("browser_type_ref", "Type into referenced browser element", "Enter text into a recently inspected element.", "local.browser.type", "R2"),
      tool("browser_extract", "Extract browser text", "Read visible text from a page.", "local.browser.extract", "R0"),
      tool("browser_inspect", "Inspect browser DOM", "Inspect visible text and interactive page elements.", "local.browser.read", "R1"),
      tool("browser_wait_for", "Wait for browser page", "Wait for page load, selectors or text.", "local.browser.read", "R0"),
      tool("browser_get_console", "Read browser console", "Read recent page console output.", "local.browser.read", "R1"),
      tool("browser_get_network", "Read browser network", "Read recent request and response metadata.", "local.browser.read", "R1"),
      tool("browser_get_network_body", "Read browser response body", "Read a bounded response body after explicit approval.", "local.browser.read", "R2"),
      tool("browser_get_performance", "Read browser performance", "Read Navigation Timing, paint and resource metrics.", "local.browser.read", "R1"),
      tool("browser_get_diagnostics", "Diagnose browser page", "Summarize console, network and performance problems.", "local.browser.read", "R1"),
      tool("browser_export_har", "Export browser HAR", "Create a redacted HAR file without bodies or cookies.", "local.fs.create", "R2"),
      tool("browser_screenshot", "Capture browser screenshot", "Capture the visible browser page.", "local.browser.screenshot", "R1"),
      tool("browser_attached_navigate", "Navigate attached browser", "Navigate an already-connected Attached Browser page.", "local.browser.navigate", "R1"),
      tool("browser_attached_inspect", "Inspect attached browser", "Inspect visible Attached Browser DOM after explicit approval.", "local.browser.read", "R2"),
      tool("browser_attached_click_ref", "Click attached browser element", "Click a recently inspected Attached Browser element.", "local.browser.click", "R2"),
      tool("browser_attached_type_ref", "Type in attached browser", "Enter text into a recently inspected Attached Browser element.", "local.browser.type", "R2"),
      tool("browser_attached_get_console", "Read attached browser console", "Read console output from an attached signed-in browser.", "local.browser.read", "R2"),
      tool("browser_attached_get_network", "Read attached browser network", "Read redacted network metadata from an attached browser.", "local.browser.read", "R2"),
      tool("browser_attached_get_network_body", "Read attached response body", "Read a bounded response body from an attached browser.", "local.browser.read", "R3"),
      tool("browser_attached_screenshot", "Capture attached browser screenshot", "Capture a connected Attached Browser page.", "local.browser.screenshot", "R2"),
      tool("browser_upload", "Upload project file", "Upload project files after explicit approval.", "local.browser.upload", "R3")
    ],
    workflowNodes: [
      node("local.browser.navigate", "Open web page", "Open a URL in the visible managed browser."),
      node("local.browser.click", "Click web page", "Click an element in the managed browser."),
      node("local.browser.type", "Type on web page", "Enter text in the managed browser."),
      node("local.browser.extract", "Extract web content", "Extract visible content from the managed browser."),
      node("local.browser.screenshot", "Capture web page", "Capture the current managed browser page."),
      node("local.browser.upload", "Upload file", "Upload a project file through the managed browser.")
    ],
    connectors: [
      { id: "browser.managed", title: "Managed Browser", status: "available", kind: "browser_provider" },
      { id: "browser.attached.chromium", title: "Attached Chromium", status: "available", kind: "browser_provider" }
    ]
  }
} as const satisfies PluginManifest;

const SPREADSHEET_PLUGIN = {
  schemaVersion: 1,
  id: "ai.routemarket.spreadsheet",
  name: "RouteMarket Spreadsheet",
  description: "Spreadsheet preview, native generation, bounded inspection, conflict-safe range editing and CSV export.",
  version: "0.1.0",
  publisher: "PXTechAI",
  kind: "declarative_plugin",
  status: "available",
  distribution: { source: "bundled", packageFormat: "declarative" },
  engines: { routemarketWork: "^0.2.0" },
  permissions: ["project.read", "project.write", "artifact.read", "artifact.write"],
  activationEvents: ["onFile:.xlsx", "onFile:.xls", "onFile:.csv", "onFile:.tsv", "onTool:spreadsheet"],
  contributes: {
    viewers: [{
      id: "spreadsheet.viewer",
      title: "Spreadsheet Preview",
      status: "available",
      extensions: [".xlsx", ".csv", ".tsv"],
      mimeTypes: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
        "text/tab-separated-values"
      ],
      mode: "readonly"
    }, {
      id: "spreadsheet.legacy-viewer",
      title: "Legacy Excel Preview",
      status: "planned",
      extensions: [".xls"],
      mimeTypes: ["application/vnd.ms-excel"],
      mode: "readonly"
    }],
    tools: [
      tool("spreadsheet", "Spreadsheet", "Create, inspect, read, edit and export spreadsheet files through explicit operations.", "local.spreadsheet.write", "R2", "available")
    ],
    workflowNodes: [
      node("local.spreadsheet.inspect", "Inspect workbook", "Inspect workbook structure and metadata.", "planned"),
      node("local.spreadsheet.read_range", "Read spreadsheet range", "Read a bounded range from a workbook.", "planned"),
      node("local.spreadsheet.create", "Create spreadsheet", "Create a spreadsheet artifact.", "planned"),
      node("local.spreadsheet.write_range", "Write spreadsheet range", "Write cells to a workbook with conflict protection.", "planned"),
      node("local.spreadsheet.export_csv", "Export spreadsheet CSV", "Export spreadsheet data as CSV.", "planned")
    ],
    connectors: [{
      id: "spreadsheet.microsoft-excel",
      title: "Microsoft Excel",
      status: "planned",
      kind: "native_app"
    }]
  }
} as const satisfies PluginManifest;

const PDF_PLUGIN = {
  schemaVersion: 1,
  id: "ai.routemarket.pdf",
  name: "RouteMarket PDF",
  description: "Isolated PDF preview with planned extraction, generation and page-level operations.",
  version: "0.1.0",
  publisher: "PXTechAI",
  kind: "declarative_plugin",
  status: "available",
  distribution: { source: "bundled", packageFormat: "declarative" },
  engines: { routemarketWork: "^0.2.0" },
  permissions: ["project.read", "project.write", "artifact.read", "artifact.write"],
  activationEvents: ["onFile:.pdf"],
  contributes: {
    viewers: [{
      id: "pdf.viewer",
      title: "PDF Preview",
      status: "available",
      extensions: [".pdf"],
      mimeTypes: ["application/pdf"],
      mode: "readonly"
    }],
    tools: [
      tool("pdf.inspect", "Inspect PDF", "Inspect pages, metadata and document structure.", "local.pdf.read", "R0", "planned"),
      tool("pdf.extract_text", "Extract PDF text", "Extract bounded text from selected PDF pages.", "local.pdf.read", "R0", "planned"),
      tool("pdf.create", "Create PDF", "Create a PDF artifact from supported content.", "local.pdf.write", "R2", "planned"),
      tool("pdf.merge", "Merge PDFs", "Merge project PDFs into a new artifact.", "local.pdf.write", "R2", "planned"),
      tool("pdf.split", "Split PDF", "Create new artifacts from selected page ranges.", "local.pdf.write", "R2", "planned")
    ],
    workflowNodes: [
      node("local.pdf.inspect", "Inspect PDF", "Inspect PDF metadata and pages.", "planned"),
      node("local.pdf.extract_text", "Extract PDF text", "Extract text from selected pages.", "planned"),
      node("local.pdf.create", "Create PDF", "Create a PDF artifact.", "planned"),
      node("local.pdf.merge", "Merge PDFs", "Merge PDFs into a new artifact.", "planned"),
      node("local.pdf.split", "Split PDF", "Split PDF into new artifacts.", "planned")
    ],
    connectors: []
  }
} as const satisfies PluginManifest;

const BUILTIN_PLUGINS: readonly PluginManifest[] = [
  BROWSER_PLUGIN,
  SPREADSHEET_PLUGIN,
  PDF_PLUGIN
];

function tool(
  name: string,
  title: string,
  description: string,
  capability: string,
  risk: "R0" | "R1" | "R2" | "R3",
  status: "available" | "planned" | "disabled" = "available"
) {
  return { name, title, status, description, capability, risk };
}

function node(
  executorKey: string,
  title: string,
  description: string,
  status: "available" | "planned" | "disabled" = "available"
) {
  return { executorKey, title, status, description };
}

function assertUniqueContributions(plugins: PluginManifest[]): void {
  const pluginIds = new Set<string>();
  const contributionIds = new Map<string, string>();
  for (const plugin of plugins) {
    if (pluginIds.has(plugin.id)) throw new Error(`Duplicate plugin id: ${plugin.id}`);
    pluginIds.add(plugin.id);
    const values = [
      ...plugin.contributes.viewers.map((item) => `viewer:${item.id}`),
      ...plugin.contributes.tools.map((item) => `tool:${item.name}`),
      ...plugin.contributes.workflowNodes.map((item) => `workflow:${item.executorKey}`),
      ...plugin.contributes.connectors.map((item) => `connector:${item.id}`)
    ];
    for (const value of values) {
      const owner = contributionIds.get(value);
      if (owner) throw new Error(`Duplicate contribution ${value}: ${owner}, ${plugin.id}`);
      contributionIds.set(value, plugin.id);
    }
  }
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
