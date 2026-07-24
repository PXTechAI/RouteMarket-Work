import { describe, expect, it } from "vitest";
import type { ChatModel } from "../../../../shared/desktop-api";
import {
  resolveAvailableWebSearchMode,
  supportsNativeWebSearch
} from "./web-search-mode";

function model(
  input: Partial<ChatModel> = {}
): ChatModel {
  return {
    code: "model",
    displayName: "Model",
    category: "chat",
    supportsTools: true,
    supportsNativeWebSearch: false,
    supportsVision: false,
    supportsStream: true,
    preferredChatProtocol: null,
    ...input
  };
}

describe("web search mode availability", () => {
  it("requires native capability and the Responses protocol", () => {
    expect(supportsNativeWebSearch(model({
      supportsNativeWebSearch: true
    }))).toBe(false);
    expect(supportsNativeWebSearch(model({
      supportsNativeWebSearch: true,
      preferredChatProtocol: "openai_responses"
    }))).toBe(true);
  });

  it("falls back from unavailable native search to intelligent search", () => {
    expect(resolveAvailableWebSearchMode(model(), "native")).toBe("agentic");
  });

  it("falls back from unavailable intelligent search to native or off", () => {
    expect(resolveAvailableWebSearchMode(model({
      supportsTools: false,
      supportsNativeWebSearch: true,
      preferredChatProtocol: "openai_responses"
    }), "agentic")).toBe("native");
    expect(resolveAvailableWebSearchMode(model({
      supportsTools: false
    }), "agentic")).toBe("off");
  });

  it("keeps an explicit off selection", () => {
    expect(resolveAvailableWebSearchMode(model(), "off")).toBe("off");
  });
});
