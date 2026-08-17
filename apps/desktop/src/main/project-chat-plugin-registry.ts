import type { ToolApprovalMode } from "./tool-broker";
import type {
  ProjectChatToolCall,
  ProjectChatToolDefinition,
  ProjectChatToolExecution
} from "./project-chat-tools";

export type ProjectChatPluginExecutionContext = {
  localProjectId: string;
  call: ProjectChatToolCall;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  approvalMode: ToolApprovalMode;
};

export type ProjectChatPluginTool = {
  pluginId: string;
  definition: ProjectChatToolDefinition;
  execute(context: ProjectChatPluginExecutionContext): Promise<ProjectChatToolExecution>;
};

export class ProjectChatPluginRegistry {
  private readonly tools = new Map<string, ProjectChatPluginTool>();

  register(tool: ProjectChatPluginTool): void {
    const name = tool.definition.function.name;
    if (this.tools.has(name)) throw new Error(`Duplicate Plugin tool: ${name}`);
    this.tools.set(name, tool);
  }

  listDefinitions(): ProjectChatToolDefinition[] {
    return [...this.tools.values()].map((tool) => structuredClone(tool.definition));
  }

  find(name: string): ProjectChatPluginTool | null {
    return this.tools.get(name) ?? null;
  }

  removeByPluginId(pluginId: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.pluginId === pluginId) this.tools.delete(name);
    }
  }
}
