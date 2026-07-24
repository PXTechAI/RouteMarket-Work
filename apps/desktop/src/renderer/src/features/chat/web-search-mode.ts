import type {
  ChatModel,
  WebSearchMode
} from "../../../../shared/desktop-api";

export function supportsNativeWebSearch(model: ChatModel | null): boolean {
  return Boolean(
    model?.supportsNativeWebSearch &&
    model.preferredChatProtocol === "openai_responses"
  );
}

export function resolveAvailableWebSearchMode(
  model: ChatModel | null,
  requested: WebSearchMode
): WebSearchMode {
  if (!model || requested === "off") return requested;
  if (requested === "native" && !supportsNativeWebSearch(model)) {
    return model.supportsTools ? "agentic" : "off";
  }
  if (requested === "agentic" && !model.supportsTools) {
    return supportsNativeWebSearch(model) ? "native" : "off";
  }
  return requested;
}
