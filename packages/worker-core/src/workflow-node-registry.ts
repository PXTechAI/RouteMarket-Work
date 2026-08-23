import { createHash } from "node:crypto";
import type {
  DesktopWorkflowNodeDefinition,
  DesktopWorkflowNodeRegistry,
} from "@routemarket/work-protocol";
import type { McpServerSummary, McpTool } from "./stdio-mcp-host";
import type { ProjectSkillSummary } from "./project-context";

type DefinitionInput = Omit<DesktopWorkflowNodeDefinition, "definitionHash">;

export function buildDesktopWorkflowNodeRegistry(input: {
  mcpServers: McpServerSummary[];
  skills: ProjectSkillSummary[];
  generatedAt?: string;
}): DesktopWorkflowNodeRegistry {
  const definitions = [
    ...BUILTIN_DEFINITIONS,
    ...input.mcpServers.flatMap(mcpDefinitions),
    ...input.skills.map(skillDefinition),
  ]
    .map(finalizeDefinition)
    .sort((left, right) => left.executorKey.localeCompare(right.executorKey));
  return {
    revisionHash: hashCanonical(
      definitions.map(({ definitionHash, ...definition }) => definition),
    ),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    definitions,
  };
}

const objectSchema = { type: "object", additionalProperties: true } as const;
const BUILTIN_DEFINITIONS: DefinitionInput[] = [
  builtin("local.fs.read", "读取文件", "读取项目内文本文件。", "portable", schema({
    relativePath: stringField(4_096),
  }, ["relativePath"])),
  builtin(
    "local.fs.search",
    "搜索项目",
    "搜索项目路径和文本内容。",
    "portable",
    schema({ query: stringField(256) }, ["query"]),
  ),
  builtin(
    "local.fs.write",
    "修改文件",
    "以乐观锁安全修改项目文件。",
    "portable",
    schema({
      relativePath: stringField(4_096),
      text: stringField(1_000_000, { multiline: true }),
      expectedSha256: stringField(64),
    }, ["relativePath", "text", "expectedSha256"]),
  ),
  builtin(
    "local.fs.create",
    "新建文件",
    "在项目中安全创建新文件。",
    "portable",
    schema({
      relativePath: stringField(4_096),
      text: stringField(1_000_000, { multiline: true }),
    }, ["relativePath", "text"]),
  ),
  builtin(
    "local.process.start",
    "启动进程",
    "在项目目录启动受控进程。",
    "device_bound",
    schema({
      executable: stringField(1_024),
      args: stringArrayField(128),
    }, ["executable", "args"]),
  ),
  builtin("local.process.stop", "停止进程", "停止受控进程树。", "device_bound", schema({
    processId: stringField(128),
  }, ["processId"])),
  builtin(
    "local.browser.navigate",
    "打开网页",
    "在可见的内置浏览器中打开网页。",
    "device_bound",
    schema({
      url: stringField(8_192, { format: "uri" }),
      pageId: stringField(256, { advanced: true }),
    }, ["url"]),
  ),
  builtin(
    "local.browser.click",
    "点击网页",
    "点击内置浏览器中的元素。",
    "device_bound",
    schema({
      selector: stringField(2_048),
      pageId: stringField(256, { advanced: true }),
    }, ["selector"]),
  ),
  builtin(
    "local.browser.type",
    "网页输入",
    "向内置浏览器元素输入文本。",
    "device_bound",
    schema({
      selector: stringField(2_048),
      text: stringField(100_000, { multiline: true }),
      pageId: stringField(256, { advanced: true }),
    }, ["selector", "text"]),
  ),
  builtin(
    "local.browser.upload",
    "上传文件",
    "把项目内文件上传到内置浏览器页面。",
    "device_bound",
    schema({
      selector: stringField(2_048),
      relativePaths: stringArrayField(20),
      pageId: stringField(256, { advanced: true }),
    }, ["selector", "relativePaths"]),
  ),
  builtin(
    "local.browser.extract",
    "提取网页",
    "提取内置浏览器中的文本。",
    "device_bound",
    schema({
      selector: stringField(2_048),
      pageId: stringField(256, { advanced: true }),
    }, ["selector"]),
  ),
  amazonProductDefinition(),
  builtin(
    "local.browser.screenshot",
    "网页截图",
    "截取内置浏览器当前页面。",
    "device_bound",
    schema({ pageId: stringField(256, { advanced: true }) }),
  ),
  monitorScreenshotDefinition(),
  qqMailSendDefinition(),
  csvExportDefinition(),
  xlsxAppendDefinition(),
  builtin(
    "desktop.trigger.file_changed",
    "文件变更触发",
    "项目内文件发生变化时启动工作流。",
    "device_bound",
    schema({ relativePath: stringField(4_096) }, ["relativePath"]),
  ),
  builtin(
    "desktop.trigger.folder_added",
    "文件夹新增触发",
    "项目内新增文件夹时启动工作流。",
    "device_bound",
    schema({ relativePath: stringField(4_096) }, ["relativePath"]),
  ),
  builtin(
    "desktop.trigger.schedule",
    "本地定时触发",
    "按当前设备的持久化时间间隔启动工作流。",
    "device_bound",
    schema({
      intervalMinutes: {
        type: "integer",
        minimum: 1,
        maximum: 525_600,
        default: 10,
      },
    }, ["intervalMinutes"]),
  ),
  builtin(
    "desktop.trigger.hotkey",
    "快捷键触发",
    "通过当前设备的全局快捷键启动工作流。",
    "device_bound",
    schema({ accelerator: stringField(128) }, ["accelerator"]),
  ),
  builtin(
    "control.approval",
    "人工审批",
    "等待本机用户批准后继续。",
    "device_bound",
    schema({ message: stringField(4_096, { multiline: true }) }),
  ),
];

function builtin(
  executorKey: string,
  title: string,
  description: string,
  portability: DesktopWorkflowNodeDefinition["portability"],
  inputSchema: Record<string, unknown> = objectSchema,
): DefinitionInput {
  return {
    executorKey,
    definitionVersion: 1,
    source: "desktop_builtin",
    executionTarget: "desktop",
    inputSchema,
    outputSchema: objectSchema,
    requiredCapabilities: [executorKey],
    portability,
    title,
    description,
    available: true,
    blockedReason: null,
  };
}

function schema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}

function stringField(
  maxLength: number,
  ui: { advanced?: boolean; format?: string; multiline?: boolean } = {},
): Record<string, unknown> {
  return {
    type: "string",
    maxLength,
    ...(ui.format ? { format: ui.format } : {}),
    ...(ui.advanced || ui.multiline ? {
      "x-ui": {
        ...(ui.advanced ? { advanced: true } : {}),
        ...(ui.multiline ? { control: "textarea" } : {}),
      },
    } : {}),
  };
}

function stringArrayField(maxItems: number): Record<string, unknown> {
  return {
    type: "array",
    items: { type: "string", maxLength: 8_192 },
    maxItems,
    "x-ui": { control: "string-list" },
  };
}

function amazonProductDefinition(): DefinitionInput {
  return {
    ...builtin(
      "local.browser.product_extract",
      "识别 Amazon 商品",
      "从内置浏览器当前页面识别单个商品的名称与价格。",
      "device_bound",
    ),
    inputSchema: {
      type: "object",
      properties: {
        sourceUrl: { type: "string", format: "uri", minLength: 1, maxLength: 8_192 },
        pageId: { type: "string", maxLength: 256 },
        titleSelectors: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 2_048 },
          maxItems: 16,
        },
        priceSelectors: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 2_048 },
          maxItems: 16,
        },
      },
      required: ["sourceUrl"],
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: {
        productTitle: { type: "string" },
        priceText: { type: "string" },
        priceValue: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        sourceUrl: { type: "string" },
        capturedAt: { type: "string" },
      },
      required: [
        "productTitle",
        "priceText",
        "priceValue",
        "currency",
        "sourceUrl",
        "capturedAt",
      ],
      additionalProperties: false,
    },
  };
}

function csvExportDefinition(): DefinitionInput {
  return {
    ...builtin(
      "local.data.csv_export",
      "导出商品价格表",
      "把识别结果保存为 Excel 可直接打开的 UTF-8 CSV 文件。",
      "device_bound",
    ),
    inputSchema: {
      type: "object",
      properties: {
        outputDirectory: { type: "string", minLength: 1, maxLength: 32_768 },
        fileName: { type: "string", maxLength: 200 },
        productTitle: { type: "string" },
        priceText: { type: "string" },
        priceValue: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        sourceUrl: { type: "string" },
        capturedAt: { type: "string" },
      },
      required: [
        "outputDirectory",
        "productTitle",
        "priceText",
        "sourceUrl",
        "capturedAt",
      ],
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string" },
        savedPath: { type: "string" },
        rowCount: { type: "number", const: 1 },
      },
      required: ["fileName", "savedPath", "rowCount"],
      additionalProperties: false,
    },
  };
}

function monitorScreenshotDefinition(): DefinitionInput {
  return {
    ...builtin(
      "local.browser.screenshot_save",
      "保存网页截图",
      "截取当前页面并把 PNG 留存在项目目录中。",
      "device_bound",
    ),
    inputSchema: {
      type: "object",
      properties: {
        screenshotsDirectory: {
          type: "string",
          minLength: 1,
          maxLength: 4_096,
        },
        pageId: { type: "string", maxLength: 256 },
        productTitle: { type: "string" },
        priceText: { type: "string" },
        priceValue: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        sourceUrl: { type: "string" },
        capturedAt: { type: "string" },
      },
      required: [
        "screenshotsDirectory",
        "productTitle",
        "priceText",
        "sourceUrl",
        "capturedAt",
      ],
      additionalProperties: true,
    },
    outputSchema: objectSchema,
  };
}

function xlsxAppendDefinition(): DefinitionInput {
  return {
    ...builtin(
      "local.data.xlsx_append",
      "追加价格工作簿",
      "创建或更新同一个 XLSX 文件，并为本次价格记录追加一行。",
      "device_bound",
    ),
    inputSchema: {
      type: "object",
      properties: {
        workbookPath: { type: "string", minLength: 1, maxLength: 4_096 },
        sheetName: { type: "string", maxLength: 31 },
        screenshotPath: { type: "string", minLength: 1, maxLength: 4_096 },
        productTitle: { type: "string" },
        priceText: { type: "string" },
        priceValue: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        sourceUrl: { type: "string" },
        capturedAt: { type: "string" },
      },
      required: [
        "workbookPath",
        "screenshotPath",
        "productTitle",
        "priceText",
        "sourceUrl",
        "capturedAt",
      ],
      additionalProperties: true,
    },
    outputSchema: objectSchema,
  };
}

function qqMailSendDefinition(): DefinitionInput {
  return {
    ...builtin(
      "local.browser.qq_mail_send",
      "通过 QQ 邮箱发送工作簿",
      "在内置浏览器中打开 QQ 邮箱；需要登录或验证码时等待用户接管，随后附加并发送 XLSX。",
      "device_bound",
    ),
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string", format: "email", minLength: 3, maxLength: 320 },
        subject: { type: "string", maxLength: 998 },
        body: { type: "string", maxLength: 20_000, "x-ui": { control: "textarea" } },
        workbookPath: { type: "string", minLength: 1, maxLength: 4_096 },
        pageId: { type: "string", maxLength: 256 },
      },
      required: ["recipient", "workbookPath"],
      additionalProperties: true,
    },
    outputSchema: objectSchema,
  };
}

function mcpDefinitions(server: McpServerSummary): DefinitionInput[] {
  return server.tools.map((tool) => ({
    executorKey: mcpExecutorKey(server.serverId, tool),
    definitionVersion: 1,
    source: "local_extension",
    executionTarget: "desktop",
    inputSchema: tool.inputSchema,
    outputSchema: objectSchema,
    requiredCapabilities: [
      "local.mcp.call",
      `local.mcp.server.${server.serverId}`,
    ],
    portability: "requires_connector",
    title: tool.title ?? tool.name,
    description: tool.description ?? `${server.name} MCP tool`,
    available: server.status === "online",
    blockedReason: server.status === "online" ? null : "connector_offline",
  }));
}

function skillDefinition(skill: ProjectSkillSummary): DefinitionInput {
  return {
    executorKey: `skill.local.${sanitizeKey(skill.id)}`,
    definitionVersion: 1,
    source: "local_extension",
    executionTarget: "desktop",
    inputSchema: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          const: skill.id,
          default: skill.id,
        },
        task: {
          type: "string",
          minLength: 1,
          maxLength: 16_000,
          description: "需要这个 Skill 指导完成的具体任务。",
        },
      },
      required: ["skillId", "task"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        skillId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        relativePath: { type: "string" },
        task: { type: "string" },
        instructions: { type: "string" },
        truncated: { type: "boolean" },
        directive: { type: "string" },
      },
      required: [
        "skillId",
        "name",
        "description",
        "relativePath",
        "task",
        "instructions",
        "truncated",
        "directive",
      ],
      additionalProperties: false,
    },
    requiredCapabilities: ["local.skill.invoke"],
    portability: "requires_connector",
    title: skill.name,
    description: skill.description,
    available: true,
    blockedReason: null,
  };
}

function finalizeDefinition(
  input: DefinitionInput,
): DesktopWorkflowNodeDefinition {
  return { ...input, definitionHash: hashCanonical(input) };
}

function mcpExecutorKey(serverId: string, tool: McpTool): string {
  return `mcp__${sanitizeKey(serverId)}__${sanitizeKey(tool.name)}`;
}

function sanitizeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160);
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
