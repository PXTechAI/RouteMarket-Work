import { describe, expect, it, vi } from "vitest";
import { createPdfChatPlugin } from "./pdf-chat-plugin";
import type { ProjectChatToolExecution } from "./project-chat-tools";

describe("PDF chat plugin", () => {
  it("creates one PDF artifact through the native PDF runtime", async () => {
    const createProjectPdf = vi.fn(async () => ({
      relativePath: "周杰伦简介.pdf",
      filename: "周杰伦简介.pdf",
      mimeType: "application/pdf" as const,
      bytes: 24_680,
      sha256: `sha256:${"a".repeat(64)}`,
      uri: "project://project_1/%E5%91%A8%E6%9D%B0%E4%BC%A6%E7%AE%80%E4%BB%8B.pdf",
      pageCount: 3
    }));
    const runAuthorized = vi.fn(async (
      _projectId: string,
      _authorization: unknown,
      _activityTitle: string,
      _activityDetail: string,
      operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
    ) => ({ ...await operation(), isError: false }));
    const plugin = createPdfChatPlugin({ createProjectPdf, runAuthorized });

    const result = await plugin.execute({
      localProjectId: "project_1",
      call: { id: "call_1", name: "pdf", arguments: "{}" },
      args: {
        operation: "create",
        path: "周杰伦简介.pdf",
        title: "周杰伦简介",
        content: "# 生平\n\n**周杰伦**是华语音乐人。"
      },
      approvalMode: "risky_only"
    });

    expect(createProjectPdf).toHaveBeenCalledOnce();
    expect(runAuthorized).toHaveBeenCalledWith(
      "project_1",
      expect.objectContaining({ capability: "local.pdf.write", risk: "R2" }),
      "PDF",
      "周杰伦简介.pdf",
      expect.any(Function),
      "risky_only"
    );
    expect(result.isError).toBe(false);
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        relativePath: "周杰伦简介.pdf",
        mimeType: "application/pdf",
        providerId: "ai.routemarket.pdf"
      })
    ]);
    expect(JSON.parse(result.content)).toMatchObject({
      operation: "create",
      created: true,
      page_count: 3,
      output_files: [{ relative_path: "周杰伦简介.pdf", mime_type: "application/pdf" }]
    });
  });

  it("rejects helper arguments before invoking the runtime", async () => {
    const createProjectPdf = vi.fn();
    const plugin = createPdfChatPlugin({
      createProjectPdf,
      runAuthorized: vi.fn() as never
    });
    await expect(plugin.execute({
      localProjectId: "project_1",
      call: { id: "call_1", name: "pdf", arguments: "{}" },
      args: { operation: "create", path: "report.pdf", content: "Report", command: "python" },
      approvalMode: "risky_only"
    })).rejects.toThrow("Unexpected tool argument: command");
    expect(createProjectPdf).not.toHaveBeenCalled();
  });
});
