import type {
  AgentLocalToolGroup,
  ChatModel,
  DesktopAgentProfile,
  ProjectContext,
  ProjectSummary,
  WorkState
} from "../../../../shared/desktop-api";
import type { ChatMessage } from "../chat/types";

export type AgentPageModel = {
  selectedProject: ProjectSummary | null;
  authStatus: WorkState["authStatus"];
  agents: DesktopAgentProfile[];
  agentsLoading: boolean;
  selectedAgentId: string;
  selectedAgent: DesktopAgentProfile | null;
  projectContext: ProjectContext | null;
  models: ChatModel[];
  selectedModelCode: string;
  modelsLoading: boolean;
  localToolGroups: AgentLocalToolGroup[];
  maxToolRounds: number;
  messages: ChatMessage[];
  draft: string;
  activeRequestId: string | null;
  error: string | null;
};

export type AgentPageActions = {
  onChooseProject(): void;
  onSelectAgent(agentId: string): void;
  onRefreshAgents(): void;
  onModelChange(modelCode: string): void;
  onToolGroupChange(group: AgentLocalToolGroup, enabled: boolean): void;
  onMaxToolRoundsChange(value: number): void;
  onDraftChange(value: string): void;
  onUseStarterQuestion(value: string): void;
  onSend(): void;
  onStop(): void;
  onDismissError(): void;
};
