import { randomUUID } from "node:crypto";
import type {
  ManagedBrowserOperation,
  ManagedBrowserOperationKind,
  ManagedBrowserOperationSource
} from "../shared/desktop-api";

type ManagedBrowserOperationInput = {
  localProjectId: string;
  pageId: string;
  source: ManagedBrowserOperationSource;
  kind: ManagedBrowserOperationKind;
  title: string;
  detail: string;
  url: string;
  retryable: boolean;
  retryOfOperationId: string | null;
};

type ManagedBrowserOperationStoreOptions = {
  maxPerProject?: number;
  createId?: () => string;
  now?: () => string;
};

export class ManagedBrowserOperationStore {
  private readonly operations = new Map<string, ManagedBrowserOperation>();
  private readonly operationIdsByProject = new Map<string, string[]>();
  private readonly maxPerProject: number;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(options: ManagedBrowserOperationStoreOptions = {}) {
    this.maxPerProject = Math.max(1, options.maxPerProject ?? 150);
    this.createId = options.createId ?? (() => `browser_op_${randomUUID().replaceAll("-", "")}`);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  begin(input: ManagedBrowserOperationInput): ManagedBrowserOperation {
    const operation: ManagedBrowserOperation = {
      operationId: this.createId(),
      ...input,
      status: "running",
      startedAt: this.now(),
      finishedAt: null,
      error: null
    };
    this.operations.set(operation.operationId, operation);
    const ids = this.operationIdsByProject.get(operation.localProjectId) ?? [];
    ids.unshift(operation.operationId);
    while (ids.length > this.maxPerProject) {
      const removedId = ids.pop();
      if (removedId) this.operations.delete(removedId);
    }
    this.operationIdsByProject.set(operation.localProjectId, ids);
    return { ...operation };
  }

  attachPage(operationId: string, pageId: string, url: string): void {
    const operation = this.require(operationId);
    operation.pageId = pageId;
    operation.url = url;
  }

  succeed(operationId: string, url: string): void {
    const operation = this.require(operationId);
    operation.status = "succeeded";
    operation.url = url;
    operation.finishedAt = this.now();
    operation.error = null;
  }

  fail(operationId: string, error: unknown): void {
    const operation = this.require(operationId);
    operation.status = "failed";
    operation.finishedAt = this.now();
    operation.error = error instanceof Error ? error.message : "Managed Browser operation failed.";
  }

  list(localProjectId: string): ManagedBrowserOperation[] {
    return (this.operationIdsByProject.get(localProjectId) ?? [])
      .map((operationId) => this.operations.get(operationId))
      .filter((operation): operation is ManagedBrowserOperation => Boolean(operation))
      .map((operation) => ({ ...operation }));
  }

  get(localProjectId: string, operationId: string): ManagedBrowserOperation | null {
    const operation = this.operations.get(operationId);
    return operation?.localProjectId === localProjectId ? { ...operation } : null;
  }

  has(operationId: string): boolean {
    return this.operations.has(operationId);
  }

  private require(operationId: string): ManagedBrowserOperation {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error("Managed Browser operation not found.");
    return operation;
  }
}
