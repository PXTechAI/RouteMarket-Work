import { getActiveLocale } from "../../i18n";
import { enUSWorkflowNodes } from "../../i18n/messages/workflow-nodes.en-US";
import { zhCNWorkflowNodes } from "../../i18n/messages/workflow-nodes.zh-CN";
import type { DesktopWorkflowNodeDefinition } from "../../../../shared/desktop-api";

export function localizeWorkflowNodeDefinition(definition: DesktopWorkflowNodeDefinition): DesktopWorkflowNodeDefinition {
  const resource = getActiveLocale() === "zh-CN" ? zhCNWorkflowNodes : enUSWorkflowNodes;
  const message = resource[definition.executorKey];
  return message ? { ...definition, ...message } : definition;
}
