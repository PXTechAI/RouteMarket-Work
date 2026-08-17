import type { DesktopWorkflowDraft } from "../../../../shared/desktop-api";

export type WorkflowDraftHistoryEntry = {
  draft: DesktopWorkflowDraft;
  dirty: boolean;
};

export type WorkflowDraftHistory = {
  past: WorkflowDraftHistoryEntry[];
  future: WorkflowDraftHistoryEntry[];
};

export type WorkflowDraftHistoryStep = WorkflowDraftHistoryEntry & {
  history: WorkflowDraftHistory;
};

const HISTORY_LIMIT = 100;

export function createWorkflowDraftHistory(): WorkflowDraftHistory {
  return { past: [], future: [] };
}

export function recordWorkflowDraftHistory(
  history: WorkflowDraftHistory,
  draft: DesktopWorkflowDraft,
  dirty: boolean
): WorkflowDraftHistory {
  return {
    past: [...history.past, { draft, dirty }].slice(-HISTORY_LIMIT),
    future: []
  };
}

export function undoWorkflowDraftHistory(
  history: WorkflowDraftHistory,
  currentDraft: DesktopWorkflowDraft,
  currentDirty: boolean
): WorkflowDraftHistoryStep | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    ...previous,
    history: {
      past: history.past.slice(0, -1),
      future: [{ draft: currentDraft, dirty: currentDirty }, ...history.future]
    }
  };
}

export function redoWorkflowDraftHistory(
  history: WorkflowDraftHistory,
  currentDraft: DesktopWorkflowDraft,
  currentDirty: boolean
): WorkflowDraftHistoryStep | null {
  const next = history.future[0];
  if (!next) return null;
  return {
    ...next,
    history: {
      past: [...history.past, { draft: currentDraft, dirty: currentDirty }],
      future: history.future.slice(1)
    }
  };
}
