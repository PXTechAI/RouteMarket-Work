import { createHash } from "node:crypto";
import type {
  DesktopWorkflowNodeDefinition,
  DesktopWorkflowNodeRegistry
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
    ...input.skills.map(skillDefinition)
  ]
    .map(finalizeDefinition)
    .sort((left, right) => left.executorKey.localeCompare(right.executorKey));
  return {
    revisionHash: hashCanonical(definitions.map(({ definitionHash, ...definition }) => definition)),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    definitions
  };
}

const objectSchema = { type: "object", additionalProperties: true } as const;
const BUILTIN_DEFINITIONS: DefinitionInput[] = [
  builtin("local.fs.read", "读取文件", "读取项目内文本文件。", "portable"),
  builtin("local.fs.search", "搜索项目", "搜索项目路径和文本内容。", "portable"),
  builtin("local.fs.write", "修改文件", "以乐观锁安全修改项目文件。", "portable"),
  builtin("local.fs.create", "新建文件", "在项目中安全创建新文件。", "portable"),
  builtin("local.process.start", "启动进程", "在项目目录启动受控进程。", "device_bound"),
  builtin("local.process.stop", "停止进程", "停止受控进程树。", "device_bound"),
  builtin("local.browser.navigate", "浏览器导航", "在可见托管浏览器中打开网页。", "device_bound"),
  builtin("local.browser.click", "点击网页", "点击托管浏览器中的元素。", "device_bound"),
  builtin("local.browser.type", "网页输入", "向托管浏览器元素输入文本。", "device_bound"),
  builtin("local.browser.extract", "提取网页", "提取托管浏览器中的文本。", "device_bound"),
  builtin("local.browser.screenshot", "网页截图", "截取托管浏览器当前页面。", "device_bound"),
  builtin("desktop.trigger.file_changed", "文件变更触发", "项目内文件发生变化时启动工作流。", "device_bound"),
  builtin("desktop.trigger.folder_added", "文件夹新增触发", "项目内新增文件夹时启动工作流。", "device_bound"),
  builtin("desktop.trigger.schedule", "本地定时触发", "按当前设备的持久化时间间隔启动工作流。", "device_bound"),
  builtin("desktop.trigger.hotkey", "快捷键触发", "通过当前设备的全局快捷键启动工作流。", "device_bound"),
  builtin("control.approval", "人工审批", "等待本机用户批准后继续。", "device_bound")
];

function builtin(
  executorKey: string,
  title: string,
  description: string,
  portability: DesktopWorkflowNodeDefinition["portability"]
): DefinitionInput {
  return {
    executorKey,
    definitionVersion: 1,
    source: "desktop_builtin",
    executionTarget: "desktop",
    inputSchema: objectSchema,
    outputSchema: objectSchema,
    requiredCapabilities: [executorKey],
    portability,
    title,
    description,
    available: true,
    blockedReason: null
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
    requiredCapabilities: ["local.mcp.call", `local.mcp.server.${server.serverId}`],
    portability: "requires_connector",
    title: tool.title ?? tool.name,
    description: tool.description ?? `${server.name} MCP tool`,
    available: server.status === "online",
    blockedReason: server.status === "online" ? null : "connector_offline"
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
          default: skill.id
        },
        task: {
          type: "string",
          minLength: 1,
          maxLength: 16_000,
          description: "需要这个 Skill 指导完成的具体任务。"
        }
      },
      required: ["skillId", "task"],
      additionalProperties: false
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
        directive: { type: "string" }
      },
      required: [
        "skillId",
        "name",
        "description",
        "relativePath",
        "task",
        "instructions",
        "truncated",
        "directive"
      ],
      additionalProperties: false
    },
    requiredCapabilities: ["local.skill.invoke"],
    portability: "requires_connector",
    title: skill.name,
    description: skill.description,
    available: true,
    blockedReason: null
  };
}

function finalizeDefinition(input: DefinitionInput): DesktopWorkflowNodeDefinition {
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
