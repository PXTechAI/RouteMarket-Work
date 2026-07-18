import { describe, expect, it } from "vitest";
import { ManagedBrowserOperationStore } from "./managed-browser-operation-store";

function operation(localProjectId: string, title = "打开网页") {
  return {
    localProjectId,
    pageId: "page_1",
    source: "workflow" as const,
    kind: "navigate" as const,
    title,
    detail: "https://example.com",
    url: "about:blank",
    retryable: true,
    retryOfOperationId: null
  };
}

describe("ManagedBrowserOperationStore", () => {
  it("records running, succeeded and failed operation state", () => {
    let sequence = 0;
    const store = new ManagedBrowserOperationStore({
      createId: () => `operation_${++sequence}`,
      now: () => `2026-07-18T00:00:0${sequence}.000Z`
    });

    const succeeded = store.begin(operation("project_1"));
    store.attachPage(succeeded.operationId, "page_2", "https://example.com/start");
    store.succeed(succeeded.operationId, "https://example.com/done");
    const failed = store.begin(operation("project_1", "点击网页元素"));
    store.fail(failed.operationId, new Error("Browser element not found"));

    expect(store.list("project_1")).toEqual([
      expect.objectContaining({
        operationId: failed.operationId,
        status: "failed",
        error: "Browser element not found"
      }),
      expect.objectContaining({
        operationId: succeeded.operationId,
        pageId: "page_2",
        status: "succeeded",
        url: "https://example.com/done"
      })
    ]);
  });

  it("isolates projects and retains only the configured project history", () => {
    let sequence = 0;
    const store = new ManagedBrowserOperationStore({
      maxPerProject: 2,
      createId: () => `operation_${++sequence}`
    });

    const first = store.begin(operation("project_1", "First"));
    store.begin(operation("project_2", "Other project"));
    store.begin(operation("project_1", "Second"));
    store.begin(operation("project_1", "Third"));

    expect(store.list("project_1").map((item) => item.title)).toEqual(["Third", "Second"]);
    expect(store.list("project_2").map((item) => item.title)).toEqual(["Other project"]);
    expect(store.has(first.operationId)).toBe(false);
    expect(store.get("project_2", first.operationId)).toBeNull();
  });
});
