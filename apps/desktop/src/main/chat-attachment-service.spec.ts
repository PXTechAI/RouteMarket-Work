import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectSelectedFiles,
  MAX_CHAT_ATTACHMENTS,
  releaseChatAttachment,
  uploadSelectedChatAttachments,
  uploadTransferredChatAttachments
} from "./chat-attachment-service";
import { RouteMarketApiClient } from "./routemarket-api-client";

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = null;
});

describe("desktop chat attachments", () => {
  it("uploads a selected text file without exposing its absolute path", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-attachment-"));
    const path = join(temporaryDirectory, "requirements.md");
    await writeFile(path, "# Requirements\nKeep local paths private.", "utf8");
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const form = init?.body as FormData;
      expect(form.get("reference_type")).toBe("chat_upload");
      expect(String(form.get("reference_id"))).toMatch(/^attachment_/);
      expect(form.get("source")).toBe("desktop_chat");
      expect(form.get("client")).toBe("routemarket_work");
      const file = form.get("file") as File;
      expect(file.name).toBe("requirements.md");
      expect(file.type).toBe("text/markdown");
      return new Response(JSON.stringify({
        asset: {
          id: "asset_1",
          storage_key: "chat/asset_1/requirements.md",
          storage_provider: "local",
          mime_type: "text/markdown",
          kind: "file",
          original_name: "requirements.md",
          size_bytes: file.size
        },
        download_url: "/api/app/v1/assets/asset_1",
        preview_url: null
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const apiClient = new RouteMarketApiClient({
      baseUrl: "https://console.routemarket.ai",
      appVersion: "0.2.0",
      fetchImpl
    });
    apiClient.setAccessToken("desktop_token");

    const attachments = await uploadSelectedChatAttachments(apiClient, [path]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: "requirements.md",
      mimeType: "text/markdown",
      kind: "file",
      assetId: "asset_1",
      downloadUrl:
        "https://console.routemarket.ai/api/app/v1/assets/asset_1",
      textExcerpt: "# Requirements\nKeep local paths private."
    });
    expect(JSON.stringify(attachments)).not.toContain(temporaryDirectory);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects an oversized selection count before reading files", async () => {
    await expect(
      inspectSelectedFiles(
        Array.from(
          { length: MAX_CHAT_ATTACHMENTS + 1 },
          (_, index) => `missing-${index}.txt`
        )
      )
    ).rejects.toThrow("一次最多添加 6 个附件");
  });

  it("uploads pasted file bytes without accepting a renderer file path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const form = init?.body as FormData;
      expect(form.get("source")).toBe("desktop_chat");
      expect(form.get("client")).toBe("routemarket_work");
      const file = form.get("file") as File;
      expect(file.name).toBe("clipboard.txt");
      expect(await file.text()).toBe("from clipboard");
      return new Response(JSON.stringify({
        asset: {
          id: "asset_clipboard",
          mime_type: "text/plain",
          kind: "file",
          original_name: file.name,
          size_bytes: file.size
        },
        download_url: "/api/app/v1/assets/asset_clipboard",
        preview_url: null
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const apiClient = new RouteMarketApiClient({
      baseUrl: "https://console.routemarket.ai",
      appVersion: "0.2.0",
      fetchImpl
    });
    apiClient.setAccessToken("desktop_token");
    const bytes = new TextEncoder().encode("from clipboard");

    const attachments = await uploadTransferredChatAttachments(apiClient, [{
      name: "clipboard.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      bytes
    }]);

    expect(attachments[0]).toMatchObject({
      name: "clipboard.txt",
      assetId: "asset_clipboard",
      textExcerpt: "from clipboard"
    });
  });

  it("rejects path-like names transferred by the renderer", async () => {
    const apiClient = new RouteMarketApiClient({
      baseUrl: "https://console.routemarket.ai",
      appVersion: "0.2.0"
    });
    const bytes = new Uint8Array([1]);
    await expect(uploadTransferredChatAttachments(apiClient, [{
      name: "C:\\private\\secret.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      bytes
    }])).rejects.toThrow();
  });

  it("releases an abandoned desktop chat upload reference", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        "https://console.routemarket.ai/api/app/v1/assets/references/release"
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        asset_id: "asset_pending",
        reference_type: "chat_upload",
        reference_id: "attachment_pending"
      });
      return new Response(JSON.stringify({ released: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const apiClient = new RouteMarketApiClient({
      baseUrl: "https://console.routemarket.ai",
      appVersion: "0.2.0",
      fetchImpl
    });
    apiClient.setAccessToken("desktop_token");

    await releaseChatAttachment(apiClient, {
      id: "attachment_pending",
      name: "pending.png",
      mimeType: "image/png",
      size: 128,
      kind: "image",
      textExcerpt: null,
      assetId: "asset_pending",
      downloadUrl: "https://console.routemarket.ai/api/app/v1/assets/asset_pending",
      previewUrl: null
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects empty files", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-attachment-"));
    const path = join(temporaryDirectory, "empty.txt");
    await writeFile(path, "");
    await expect(inspectSelectedFiles([path])).rejects.toThrow(
      "附件不能为空"
    );
  });
});
