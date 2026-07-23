import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VirtualMessageList } from "./VirtualMessageList";
import type { ChatMessage } from "./types";

function messages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message_${index}`,
    role: index % 2 ? "assistant" : "user",
    content: `Message ${index}`,
    sentAt: "2026-07-24T00:00:00.000Z"
  }));
}

describe("VirtualMessageList", () => {
  it("renders all messages below the long-conversation threshold", () => {
    const html = renderToStaticMarkup(
      <VirtualMessageList
        messages={messages(20)}
        scrollerRef={createRef<HTMLDivElement>()}
        renderMessage={(message) => (
          <span data-message-id={message.id}>{message.content}</span>
        )}
      />
    );

    expect(html.match(/data-message-id=/g)).toHaveLength(20);
    expect(html).not.toContain("virtual-message-list");
  });

  it("mounts only a bounded window for a long conversation", () => {
    const html = renderToStaticMarkup(
      <VirtualMessageList
        messages={messages(1_000)}
        scrollerRef={createRef<HTMLDivElement>()}
        renderMessage={(message) => (
          <span data-message-id={message.id}>{message.content}</span>
        )}
      />
    );
    const rendered = html.match(/data-message-id=/g)?.length ?? 0;

    expect(html).toContain('data-message-count="1000"');
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(10);
    expect(html).toContain("Message 0");
    expect(html).not.toContain("Message 999");
  });
});
