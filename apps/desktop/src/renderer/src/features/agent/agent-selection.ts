import type { DesktopAgentProfile } from "../../../../shared/desktop-api";

type SelectAgentIdOptions = {
  agents: DesktopAgentProfile[];
  rememberedAgentId?: string | null;
  defaultAgentId?: string | null;
  currentAgentId?: string | null;
};

export function selectAgentId({
  agents,
  rememberedAgentId,
  defaultAgentId,
  currentAgentId
}: SelectAgentIdOptions): string {
  const availableAgentIds = new Set(agents.map((agent) => agent.id));
  const candidates = [rememberedAgentId, defaultAgentId, currentAgentId];

  for (const candidate of candidates) {
    if (candidate && availableAgentIds.has(candidate)) {
      return candidate;
    }
  }

  return agents[0]?.id ?? "";
}
