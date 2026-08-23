import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessageRow } from "./ChatMessageRow";

describe("ChatMessageRow", () => {
  it("renders persisted Agent, Tool, attachment, and response metadata", () => {
    const markup = renderToStaticMarkup(
      <ChatMessageRow
        message={{
          id: "assistant:request_1",
          role: "assistant",
          content: "Finished the task.",
          sentAt: "2026-08-18T01:00:00.000Z",
          agentName: "Project Builder",
          agentRevision: 7,
          attachments: [{
            id: "attachment_1",
            name: "requirements.md",
            mimeType: "text/markdown",
            size: 128,
            kind: "file",
            textExcerpt: "Requirements preview",
            assetId: "asset_1",
            downloadUrl: "https://example.test/requirements.md",
            previewUrl: null
          }],
          artifacts: [{
            id: "artifact_1",
            kind: "file",
            relativePath: "output/report.pdf",
            filename: "report.pdf",
            mimeType: "application/pdf",
            size: 2_048,
            uri: "project://project_1/output/report.pdf",
            providerId: "local"
          }],
          tools: [{
            toolCallId: "tool_1",
            toolName: "skill_local_review",
            title: "Run review Skill",
            status: "completed",
            startedAt: 1_000,
            endedAt: 1_450,
            inputPreview: "{\n  \"task\": \"review\"\n}",
            outputPreview: "Review complete"
          }],
          responseMeta: {
            modelCode: "gpt-5.6-terra",
            inputTokens: 120,
            outputTokens: 45,
            totalTokens: 165,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            elapsedMs: 2_450
          }
        }}
        streaming={false}
      />
    );

    expect(markup).toContain("Project Builder");
    expect(markup).toContain("v7");
    expect(markup).toContain("requirements.md");
    expect(markup).toContain("Run review Skill");
    expect(markup).toContain("Review complete");
    expect(markup).toContain("gpt-5.6-terra");
    expect(markup).toContain("165");
    expect(markup).toContain("message-response-meta");
    expect(markup).toContain("message-artifact-main");
    expect(markup).toContain("report.pdf");
  });
});
