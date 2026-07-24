import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectSelectedFiles,
  MAX_CHAT_ATTACHMENTS,
  uploadSelectedChatAttachments
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
  });

  it("rejects an oversized selection count before reading files", async () => {
    await expect(
      inspectSelectedFiles(
        Array.from(
          { length: MAX_CHAT_ATTACHMENTS + 1 },
          (_, index) => `missing-${index}.txt`
        )
      )
    ).rejects.toThrow("一次最多添加 5 个附件");
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
