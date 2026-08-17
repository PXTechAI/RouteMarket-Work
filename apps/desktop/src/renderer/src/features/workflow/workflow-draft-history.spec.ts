import { describe, expect, it } from "vitest";
import type { DesktopWorkflowDraft } from "../../../../shared/desktop-api";
import {
  createWorkflowDraftHistory,
  recordWorkflowDraftHistory,
  redoWorkflowDraftHistory,
  undoWorkflowDraftHistory
} from "./workflow-draft-history";

describe("workflow draft history", () => {
  it("undoes and redoes while preserving the saved dirty state", () => {
    const original = draft("Original");
    const edited = draft("Edited");
    const history = recordWorkflowDraftHistory(
      createWorkflowDraftHistory(),
      original,
      false
    );

    const undone = undoWorkflowDraftHistory(history, edited, true);
    expect(undone).toMatchObject({ draft: original, dirty: false });

    const redone = redoWorkflowDraftHistory(
      undone!.history,
      undone!.draft,
      undone!.dirty
    );
    expect(redone).toMatchObject({ draft: edited, dirty: true });
  });

  it("clears the redo branch after a new edit", () => {
    const original = draft("Original");
    const edited = draft("Edited");
    const history = recordWorkflowDraftHistory(
      createWorkflowDraftHistory(),
      original,
      false
    );
    const undone = undoWorkflowDraftHistory(history, edited, true)!;
    const branched = recordWorkflowDraftHistory(
      undone.history,
      undone.draft,
      undone.dirty
    );

    expect(branched.future).toEqual([]);
  });

  it("keeps at most one hundred undo entries", () => {
    let history = createWorkflowDraftHistory();
    for (let index = 0; index < 105; index += 1) {
      history = recordWorkflowDraftHistory(history, draft(String(index)), true);
    }

    expect(history.past).toHaveLength(100);
    expect(history.past[0]?.draft.name).toBe("5");
  });
});

function draft(name: string): DesktopWorkflowDraft {
  return {
    workflowId: "workflow_test",
    localProjectId: "project_test",
    kind: "workflow",
    name,
    nodes: [],
    edges: [],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  };
}
