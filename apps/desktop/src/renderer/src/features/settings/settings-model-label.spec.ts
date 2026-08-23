import { describe, expect, it } from "vitest";
import type { ChatModel } from "../../../../shared/desktop-api";
import { gatewayModelLabel } from "./SettingsPage";

const common = {
  category: "chat" as const,
  supportsTools: true,
  supportsNativeWebSearch: false,
  supportsVision: false,
  supportsStream: true,
  supportsReasoningSummary: false,
  preferredChatProtocol: null
};

describe("settings usage model labels", () => {
  it("uses the usage record provider when RouteMarket has a model with the same id", () => {
    const models: ChatModel[] = [
      {
        ...common,
        code: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        source: "routemarket",
        providerId: null,
        providerName: "RouteMarket"
      },
      {
        ...common,
        code: "external:provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:ZGVlcHNlZWstdjQtZmxhc2g",
        displayName: "DeepSeek V4 Flash",
        source: "external",
        providerId: "provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        providerName: "DeepSeek"
      }
    ];
    expect(gatewayModelLabel(
      "deepseek-v4-flash",
      models,
      "provider_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "DeepSeek"
    )).toBe("DeepSeek · DeepSeek V4 Flash");
  });
});
