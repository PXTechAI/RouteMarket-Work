import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentLocalToolGroup,
  ChatModel,
  ProjectChatEvent,
  ProjectContext,
  ProjectSummary,
  RouteMarketWorkApi,
  WorkState
} from "../../../../shared/desktop-api";
import type { ChatMessage } from "../chat/types";
import { selectAgentId } from "./agent-selection";
import type { AgentPageActions, AgentPageModel } from "./types";

const defaultLocalToolGroups: AgentLocalToolGroup[] = [
  "files",
  "processes",
  "browser",
  "mcp",
  "skills"
];

type AgentWorkspaceOptions = {
  api: RouteMarketWorkApi;
  active: boolean;
  authStatus: WorkState["authStatus"];
  selectedProject: ProjectSummary | null;
  projectContext: ProjectContext | null;
  models: ChatModel[];
  modelsLoading: boolean;
  onChooseProject(): void;
};

export function useAgentWorkspace({
  api,
  active,
  authStatus,
  selectedProject,
  projectContext,
  models,
  modelsLoading,
  onChooseProject
}: AgentWorkspaceOptions): {
  model: AgentPageModel;
  actions: AgentPageActions;
  stopActive(): Promise<void>;
} {
  const [agents, setAgents] = useState<AgentPageModel["agents"]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedModelCode, setSelectedModelCode] = useState("");
  const [localToolGroups, setLocalToolGroups] = useState<AgentLocalToolGroup[]>(
    defaultLocalToolGroups
  );
  const [maxToolRounds, setMaxToolRounds] = useState(4);
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [draft, setDraft] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionIdsRef = useRef(new Map<string, string>());
  const selectedAgentsByProjectRef = useRef(new Map<string, string>());
  const selectionProjectIdRef = useRef<string | null>(null);
  const activeRequestRef = useRef<{
    requestId: string;
    conversationKey: string;
  } | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const conversationKey =
    selectedProject && selectedAgent
      ? `${selectedProject.localProjectId}:${selectedAgent.id}`
      : "";
  const messages = conversationKey
    ? messagesByConversation[conversationKey] ?? []
    : [];

  const refreshAgents = useCallback(async (silent = false) => {
    if (authStatus !== "signed_in") {
      setAgents([]);
      setSelectedAgentId("");
      return;
    }
    if (!silent) {
      setAgentsLoading(true);
      setError(null);
    }
    try {
      const nextAgents = await api.listAgentProfiles();
      setAgents(nextAgents);
    } catch (nextError) {
      if (!silent) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "RouteMarket Agent 加载失败"
        );
      }
    } finally {
      if (!silent) setAgentsLoading(false);
    }
  }, [api, authStatus]);

  useEffect(() => {
    if (!active || authStatus !== "signed_in") return;
    void refreshAgents();
  }, [active, authStatus, refreshAgents]);

  useEffect(() => {
    if (!active || authStatus !== "signed_in") return;
    const timer = window.setInterval(() => {
      void refreshAgents(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [active, authStatus, refreshAgents]);

  useEffect(() => {
    if (authStatus === "signed_in") return;
    setAgents([]);
    setSelectedAgentId("");
    setSelectedModelCode("");
    setError(null);
    selectedAgentsByProjectRef.current.clear();
    selectionProjectIdRef.current = null;
  }, [authStatus]);

  useEffect(() => {
    const projectId = selectedProject?.localProjectId ?? null;
    if (!projectId) {
      selectionProjectIdRef.current = null;
      setSelectedAgentId("");
      return;
    }

    const sameProject = selectionProjectIdRef.current === projectId;
    selectionProjectIdRef.current = projectId;
    setSelectedAgentId((current) =>
      selectAgentId({
        agents,
        rememberedAgentId: selectedAgentsByProjectRef.current.get(projectId),
        defaultAgentId: sameProject
          ? projectContext?.settings.defaultAgent
          : null,
        currentAgentId: sameProject ? current : null
      })
    );
  }, [
    agents,
    projectContext?.settings.defaultAgent,
    selectedProject?.localProjectId
  ]);

  useEffect(() => {
    const preferred = selectedAgent?.defaultModelCode;
    setSelectedModelCode((current) => {
      if (preferred && models.some((model) => model.code === preferred)) {
        return preferred;
      }
      if (models.some((model) => model.code === current)) return current;
      return models[0]?.code ?? "";
    });
  }, [models, selectedAgent]);

  useEffect(() => {
    return api.onProjectChatEvent((event) => {
      const activeRequest = activeRequestRef.current;
      if (!activeRequest || event.requestId !== activeRequest.requestId) return;
      const key = activeRequest.conversationKey;

      if (event.type === "error") {
        setError(event.message);
        setMessagesByConversation((current) =>
          updateAssistantMessage(current, key, event.requestId, (message) => ({
            ...message,
            content: message.content || `请求失败：${event.message}`
          }))
        );
        activeRequestRef.current = null;
        setActiveRequestId(null);
        return;
      }

      if (
        event.type === "tool_started" ||
        event.type === "tool_completed" ||
        event.type === "tool_error"
      ) {
        setMessagesByConversation((current) =>
          updateAssistantMessage(current, key, event.requestId, (message) => ({
            ...message,
            tools: updateToolActivity(message.tools ?? [], event)
          }))
        );
        return;
      }

      setMessagesByConversation((current) =>
        updateAssistantMessage(current, key, event.requestId, (message) => ({
          ...message,
          content: event.content,
          stopped: event.type === "stopped"
        }))
      );
      if (event.type === "complete" || event.type === "stopped") {
        activeRequestRef.current = null;
        setActiveRequestId(null);
      }
    });
  }, [api]);

  const stopActive = useCallback(async () => {
    const requestId = activeRequestRef.current?.requestId;
    if (!requestId) return;
    await api.stopProjectMessage(requestId);
  }, [api]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (
      !message ||
      !selectedProject ||
      !selectedAgent ||
      !selectedModelCode ||
      activeRequestRef.current ||
      authStatus !== "signed_in"
    ) {
      if (authStatus !== "signed_in") {
        setError("请先登录 RouteMarket 账户。");
      }
      return;
    }

    const key = `${selectedProject.localProjectId}:${selectedAgent.id}`;
    const requestId = `work_agent_${crypto.randomUUID().replaceAll("-", "")}`;
    const sessionId =
      sessionIdsRef.current.get(key) ??
      `work_agent_session_${crypto.randomUUID().replaceAll("-", "")}`;
    sessionIdsRef.current.set(key, sessionId);
    const sentAt = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user:${requestId}`,
      role: "user",
      content: message,
      sentAt
    };
    const assistantMessage: ChatMessage = {
      id: `assistant:${requestId}`,
      role: "assistant",
      content: "",
      sentAt,
      agentId: selectedAgent.id,
      agentRevision: selectedAgent.revision,
      agentName: selectedAgent.name,
      agentAvatarUrl: selectedAgent.avatarUrl
    };

    setMessagesByConversation((current) => ({
      ...current,
      [key]: [...(current[key] ?? []), userMessage, assistantMessage]
    }));
    setDraft("");
    setError(null);
    activeRequestRef.current = { requestId, conversationKey: key };
    setActiveRequestId(requestId);

    try {
      await api.sendProjectMessage({
        requestId,
        sessionId,
        sentAt,
        model: selectedModelCode,
        message,
        project: {
          localProjectId: selectedProject.localProjectId,
          displayName: selectedProject.displayName
        },
        ...(projectContext ? { projectContext } : {}),
        agent: {
          agentId: selectedAgent.id,
          agentRevision: selectedAgent.revision,
          executionEnvironment: selectedAgent.executionPolicy.environment,
          agentName: selectedAgent.name,
          agentAvatarUrl: selectedAgent.avatarUrl,
          localToolGroups,
          maxToolRounds
        }
      });
    } catch (nextError) {
      const messageText =
        nextError instanceof Error ? nextError.message : "Agent 请求发送失败";
      setError(messageText);
      setMessagesByConversation((current) =>
        updateAssistantMessage(current, key, requestId, (assistant) => ({
          ...assistant,
          content: `请求失败：${messageText}`
        }))
      );
      activeRequestRef.current = null;
      setActiveRequestId(null);
    }
  }, [
    api,
    authStatus,
    draft,
    localToolGroups,
    maxToolRounds,
    projectContext,
    selectedAgent,
    selectedModelCode,
    selectedProject
  ]);

  const actions = useMemo<AgentPageActions>(() => ({
    onChooseProject,
    onSelectAgent(agentId) {
      if (!activeRequestRef.current) {
        if (selectedProject) {
          selectedAgentsByProjectRef.current.set(
            selectedProject.localProjectId,
            agentId
          );
        }
        setSelectedAgentId(agentId);
        setError(null);
      }
    },
    onRefreshAgents: () => void refreshAgents(),
    onModelChange: setSelectedModelCode,
    onToolGroupChange(group, enabled) {
      setLocalToolGroups((current) =>
        enabled
          ? current.includes(group) ? current : [...current, group]
          : current.filter((candidate) => candidate !== group)
      );
    },
    onMaxToolRoundsChange(value) {
      setMaxToolRounds(Math.max(1, Math.min(8, Math.trunc(value || 1))));
    },
    onDraftChange: setDraft,
    onUseStarterQuestion: setDraft,
    onSend: () => void send(),
    onStop: () => void stopActive(),
    onDismissError: () => setError(null)
  }), [onChooseProject, refreshAgents, selectedProject, send, stopActive]);

  return {
    model: {
      selectedProject,
      authStatus,
      agents,
      agentsLoading,
      selectedAgentId,
      selectedAgent,
      models,
      selectedModelCode,
      modelsLoading,
      localToolGroups,
      maxToolRounds,
      messages,
      draft,
      activeRequestId,
      error
    },
    actions,
    stopActive
  };
}

function updateAssistantMessage(
  state: Record<string, ChatMessage[]>,
  conversationKey: string,
  requestId: string,
  update: (message: ChatMessage) => ChatMessage
) {
  return {
    ...state,
    [conversationKey]: (state[conversationKey] ?? []).map((message) =>
      message.id === `assistant:${requestId}` ? update(message) : message
    )
  };
}

function updateToolActivity(
  tools: NonNullable<ChatMessage["tools"]>,
  event: Extract<
    ProjectChatEvent,
    { type: "tool_started" | "tool_completed" | "tool_error" }
  >
) {
  const next = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    title: event.title,
    status:
      event.type === "tool_started"
        ? "running" as const
        : event.type === "tool_completed"
          ? "completed" as const
          : "error" as const,
    ...(event.type === "tool_completed"
      ? { detail: event.summary }
      : event.type === "tool_error"
        ? { detail: event.message }
        : {})
  };
  const existingIndex = tools.findIndex(
    (tool) => tool.toolCallId === event.toolCallId
  );
  if (existingIndex < 0) return [...tools, next];
  return tools.map((tool, index) => index === existingIndex ? next : tool);
}
