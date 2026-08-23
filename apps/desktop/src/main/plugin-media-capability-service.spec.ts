import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaGenerationRequest, MediaGenerationResult } from "../shared/desktop-api";
import { PluginMediaCapabilityService } from "./plugin-media-capability-service";

const services: PluginMediaCapabilityService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

describe("PluginMediaCapabilityService", () => {
  it("exposes declared local models and host cloud models without provider credentials", async () => {
    const service = createService();
    const session = await service.createPluginSession(
      "ai.example.avatar",
      ["models.invoke.local", "models.invoke.cloud"],
      [{
        id: "local-voice",
        title: "Local Voice",
        kind: "tts",
        required: true,
        recommendedVramMb: 4096,
        license: "Apache-2.0"
      }]
    );
    const response = await fetch(`${session.baseUrl}/v1/capabilities`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { items: Array<Record<string, unknown>> };
    expect(payload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        backendId: "plugin:local-voice",
        capability: "audio.speech.synthesize",
        execution: "local"
      }),
      expect.objectContaining({
        backendId: "host:cloud-tts",
        capability: "audio.speech.synthesize",
        execution: "cloud"
      }),
      expect.objectContaining({
        backendId: "host:cloud-tts",
        capability: "audio.music.generate",
        execution: "cloud"
      })
    ]));
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("invokes an authorized host TTS backend and rejects plugin-local invocation", async () => {
    const generateMedia = vi.fn(async () => ({
      taskId: "task-1",
      outputs: [{
        id: "audio-1",
        kind: "audio" as const,
        url: "data:audio/wav;base64,UklGRg==",
        downloadUrl: null,
        thumbnailUrl: null,
        mimeType: "audio/wav",
        revisedPrompt: null
      }]
    }));
    const service = createService(generateMedia);
    const session = await service.createPluginSession(
      "ai.example.avatar",
      ["models.invoke.local", "models.invoke.cloud"],
      [{ id: "local-voice", title: "Local Voice", kind: "tts", required: true }]
    );
    const response = await fetch(`${session.baseUrl}/v1/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "audio.speech.synthesize",
        backendId: "host:cloud-tts",
        input: { text: "你好", voice: "default", format: "wav" }
      })
    });
    expect(response.status).toBe(202);
    expect(generateMedia).toHaveBeenCalledWith({
      kind: "audio",
      model: "cloud-tts",
      prompt: "你好",
      voice: "default",
      format: "wav"
    });

    const localResponse = await fetch(`${session.baseUrl}/v1/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "audio.speech.synthesize",
        backendId: "plugin:local-voice",
        input: { text: "你好" }
      })
    });
    expect(localResponse.status).toBe(409);
  });

  it("does not reveal cloud backends without models.invoke.cloud", async () => {
    const service = createService();
    const session = await service.createPluginSession(
      "ai.example.avatar",
      ["models.invoke.local"],
      []
    );
    const response = await fetch(`${session.baseUrl}/v1/capabilities`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    const payload = await response.json() as { items: Array<{ execution: string }> };
    expect(payload.items.every((item) => item.execution === "local")).toBe(true);
  });
});

function createService(
  generateMedia: (input: MediaGenerationRequest) => Promise<MediaGenerationResult> = vi.fn(async () => ({ taskId: null, outputs: [] }))
) {
  const service = new PluginMediaCapabilityService({
    listMediaModels: vi.fn(async (kind) => kind === "audio" ? [{
      code: "cloud-tts",
      displayName: "Cloud TTS",
      category: "audio" as const,
      source: "routemarket" as const,
      providerId: null,
      providerName: "RouteMarket",
      audioModes: ["tts" as const, "music" as const],
      price: 2
    }] : []),
    generateMedia
  });
  services.push(service);
  return service;
}
