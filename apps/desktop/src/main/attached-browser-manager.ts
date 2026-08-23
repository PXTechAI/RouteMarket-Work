import { createHash, randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type {
  ManagedBrowserConsoleEntry,
  ManagedBrowserElementActionResult,
  ManagedBrowserInspection,
  ManagedBrowserNetworkBody,
  ManagedBrowserNetworkEntry
} from "../shared/desktop-api";
import { assertLocalDevToolsWebSocket, normalizeDevToolsEndpoint } from "./attached-browser-policy";
import {
  assertAgentBrowserInputAllowed,
  browserInspectionScript,
  browserReferencedElementScript
} from "./managed-browser-manager";

const MAX_DISCOVERY_BYTES = 1024 * 1024;
const MAX_EXTRACTED_TEXT = 1024 * 1024;
const MAX_CONSOLE_ENTRIES = 200;
const MAX_NETWORK_ENTRIES = 300;

type AttachedElementReference = {
  refId: string;
  locator: string;
  url: string;
  inputType: string | null;
};

export type AttachedBrowserTarget = {
  targetId: string;
  title: string;
  url: string;
  type: string;
};

export type AttachedBrowserState = {
  connected: boolean;
  endpoint: string | null;
  target: AttachedBrowserTarget | null;
  error: string | null;
};

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

type DiscoveryTarget = {
  id?: string;
  title?: string;
  url?: string;
  type?: string;
  webSocketDebuggerUrl?: string;
};

export class AttachedBrowserManager {
  private socket: WebSocket | null = null;
  private endpoint: string | null = null;
  private target: AttachedBrowserTarget | null = null;
  private lastError: string | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly consoleEntries: ManagedBrowserConsoleEntry[] = [];
  private readonly networkEntries = new Map<string, ManagedBrowserNetworkEntry>();
  private readonly networkStartTimes = new Map<string, number>();
  private readonly elementReferences = new Map<string, AttachedElementReference>();

  state(): AttachedBrowserState {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN,
      endpoint: this.endpoint,
      target: this.target ? { ...this.target } : null,
      error: this.lastError
    };
  }

  async discover(endpointValue: string): Promise<AttachedBrowserTarget[]> {
    const endpoint = normalizeDevToolsEndpoint(endpointValue);
    const response = await fetch(`${endpoint}/json/list`, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`DevTools discovery returned ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_DISCOVERY_BYTES) throw new Error("DevTools target list is too large.");
    const targets = JSON.parse(buffer.toString("utf8")) as DiscoveryTarget[];
    if (!Array.isArray(targets)) throw new Error("DevTools target list is invalid.");
    return targets
      .filter((target) => target.type === "page" && target.id && target.webSocketDebuggerUrl)
      .map((target) => ({
        targetId: target.id!,
        title: target.title ?? "Untitled page",
        url: target.url ?? "about:blank",
        type: "page"
      }));
  }

  async connect(endpointValue: string, targetId?: string): Promise<AttachedBrowserState> {
    await this.disconnect();
    const endpoint = normalizeDevToolsEndpoint(endpointValue);
    const response = await fetch(`${endpoint}/json/list`, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`DevTools discovery returned ${response.status}.`);
    const discoveryBuffer = Buffer.from(await response.arrayBuffer());
    if (discoveryBuffer.byteLength > MAX_DISCOVERY_BYTES) {
      throw new Error("DevTools target list is too large.");
    }
    const targets = JSON.parse(discoveryBuffer.toString("utf8")) as DiscoveryTarget[];
    if (!Array.isArray(targets)) throw new Error("DevTools target list is invalid.");
    const selected = targets.find((target) =>
      target.type === "page" && target.webSocketDebuggerUrl && (!targetId || target.id === targetId)
    );
    if (!selected?.id || !selected.webSocketDebuggerUrl) {
      throw new Error("No attachable DevTools page target was found.");
    }
    const socket = new WebSocket(assertLocalDevToolsWebSocket(selected.webSocketDebuggerUrl), {
      handshakeTimeout: 5_000,
      maxPayload: 4 * 1024 * 1024
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DevTools WebSocket timed out.")), 5_000);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    this.socket = socket;
    this.endpoint = endpoint;
    this.target = {
      targetId: selected.id,
      title: selected.title ?? "Untitled page",
      url: selected.url ?? "about:blank",
      type: "page"
    };
    this.lastError = null;
    this.consoleEntries.length = 0;
    this.networkEntries.clear();
    this.networkStartTimes.clear();
    this.elementReferences.clear();
    socket.on("message", (data) => this.onMessage(data));
    socket.on("close", () => this.onClosed(new Error("Attached Browser disconnected.")));
    socket.on("error", (error) => this.onClosed(error));
    await Promise.all([
      this.request("Runtime.enable"),
      this.request("Page.enable"),
      this.request("Network.enable", {
        maxTotalBufferSize: 20 * 1024 * 1024,
        maxResourceBufferSize: 2 * 1024 * 1024
      })
    ]);
    return this.state();
  }

  async disconnect(): Promise<AttachedBrowserState> {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.close();
    }
    this.rejectPending(new Error("Attached Browser disconnected."));
    this.endpoint = null;
    this.target = null;
    this.consoleEntries.length = 0;
    this.networkEntries.clear();
    this.networkStartTimes.clear();
    this.elementReferences.clear();
    return this.state();
  }

  async navigate(url: string): Promise<AttachedBrowserState> {
    const normalized = new URL(url);
    if (!["http:", "https:"].includes(normalized.protocol) || normalized.username || normalized.password) {
      throw new Error("Attached Browser navigation requires a credential-free HTTP(S) URL.");
    }
    await this.request("Page.navigate", { url: normalized.toString() });
    if (this.target) this.target.url = normalized.toString();
    this.elementReferences.clear();
    return this.state();
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(validateSelector(selector))});
      if (!element) throw new Error("Element not found");
      element.click();
      return true;
    })()`);
  }

  async type(selector: string, text: string): Promise<void> {
    if (text.length > 65_536) throw new Error("Attached Browser input exceeds 64 KiB.");
    const inputType = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(validateSelector(selector))});
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return { editable: false, inputType: null };
      }
      return {
        editable: true,
        inputType: element instanceof HTMLInputElement ? String(element.type || "text") : null
      };
    })()`) as { editable?: unknown; inputType?: unknown };
    if (inputType.editable !== true) throw new Error("Target is not a text input");
    assertAgentBrowserInputAllowed(inputType.inputType);
    await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(validateSelector(selector))});
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        throw new Error("Target is not a text input");
      }
      element.focus();
      element.value = ${JSON.stringify(text)};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }

  async extract(selector: string): Promise<string> {
    const value = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(validateSelector(selector))});
      if (!element) throw new Error("Element not found");
      return element.textContent || "";
    })()`);
    const text = String(value ?? "");
    return text.length > MAX_EXTRACTED_TEXT ? text.slice(0, MAX_EXTRACTED_TEXT) : text;
  }

  async inspect(maxElements = 200): Promise<ManagedBrowserInspection> {
    const target = this.requireTarget();
    const limit = Math.max(1, Math.min(500, Math.floor(maxElements)));
    const result = await this.evaluate(browserInspectionScript(limit)) as {
      text?: unknown;
      elements?: unknown;
      truncated?: unknown;
    };
    const rawUrl = target.url || "about:blank";
    this.elementReferences.clear();
    const elements = Array.isArray(result.elements)
      ? (result.elements.slice(0, limit) as Array<Omit<ManagedBrowserInspection["elements"][number], "refId">>)
        .map((element) => {
          const locator = String(element.locator || "").slice(0, 4_096);
          const refId = `element_${createHash("sha256")
            .update(`${target.targetId}\0${rawUrl}\0${locator}`)
            .digest("hex")
            .slice(0, 20)}`;
          this.elementReferences.set(refId, {
            refId,
            locator,
            url: rawUrl,
            inputType: element.inputType === null ? null : String(element.inputType || "").slice(0, 64)
          });
          return {
            ...element,
            refId,
            locator,
            href: element.href ? sanitizeAttachedUrl(element.href) : null
          };
        })
      : [];
    return {
      pageId: target.targetId,
      url: sanitizeAttachedUrl(rawUrl),
      title: target.title,
      text: typeof result.text === "string" ? result.text.slice(0, 100_000) : "",
      elements,
      truncated: result.truncated === true
    };
  }

  async clickRef(refIdValue: string): Promise<ManagedBrowserElementActionResult> {
    const reference = this.requireElementReference(refIdValue);
    const rawUrlBefore = this.requireTarget().url;
    const target = await this.evaluate(
      browserReferencedElementScript(reference.locator, "click")
    ) as ManagedBrowserElementActionResult["target"] | null;
    if (!target) throw staleAttachedElementError();
    await this.request("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: target.x,
      y: target.y
    });
    await this.request("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1
    });
    await this.request("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1
    });
    return this.elementActionResult(reference.refId, rawUrlBefore, target);
  }

  async typeRef(refIdValue: string, text: string): Promise<ManagedBrowserElementActionResult> {
    if (text.length > 65_536 || text.includes("\0")) {
      throw new Error("Attached Browser input exceeds safety limits.");
    }
    const reference = this.requireElementReference(refIdValue);
    assertAgentBrowserInputAllowed(reference.inputType);
    const rawUrlBefore = this.requireTarget().url;
    const target = await this.evaluate(
      browserReferencedElementScript(reference.locator, "type", text)
    ) as ManagedBrowserElementActionResult["target"] | null;
    if (!target) throw staleAttachedElementError();
    return this.elementActionResult(reference.refId, rawUrlBefore, target);
  }

  getConsole(limit = 100): ManagedBrowserConsoleEntry[] {
    this.requireTarget();
    return this.consoleEntries
      .slice(-Math.max(1, Math.min(MAX_CONSOLE_ENTRIES, Math.floor(limit))))
      .map((entry) => ({ ...entry }));
  }

  getNetwork(limit = 100): ManagedBrowserNetworkEntry[] {
    this.requireTarget();
    return [...this.networkEntries.values()]
      .slice(-Math.max(1, Math.min(MAX_NETWORK_ENTRIES, Math.floor(limit))))
      .map((entry) => ({ ...entry }));
  }

  async getNetworkBody(
    requestId: string,
    maxCharacters = 100_000
  ): Promise<ManagedBrowserNetworkBody> {
    const entry = this.networkEntries.get(requestId);
    if (!entry) throw new Error("Attached Browser network request was not found.");
    const result = await this.request<{ body?: unknown; base64Encoded?: unknown }>(
      "Network.getResponseBody",
      { requestId }
    );
    const rawBody = typeof result.body === "string" ? result.body : "";
    const encoded = result.base64Encoded === true;
    const textual = !encoded || isAttachedTextualMimeType(entry.mimeType);
    const body = encoded && textual
      ? Buffer.from(rawBody, "base64").toString("utf8")
      : rawBody;
    const limit = Math.max(1, Math.min(200_000, Math.floor(maxCharacters)));
    return {
      requestId,
      mimeType: entry.mimeType,
      body: body.slice(0, limit),
      base64Encoded: encoded && !textual,
      truncated: body.length > limit
    };
  }

  async screenshot(format: "png" | "agent" = "png"): Promise<string> {
    if (format === "png") {
      const result = await this.request<{ data?: string }>("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      });
      if (!result.data) throw new Error("DevTools did not return a screenshot.");
      return `data:image/png;base64,${result.data}`;
    }
    let data = "";
    for (const quality of [45, 30, 20]) {
      const result = await this.request<{ data?: string }>("Page.captureScreenshot", {
        format: "jpeg",
        quality,
        captureBeyondViewport: false,
        optimizeForSpeed: true
      });
      data = result.data ?? "";
      if (data.length <= 140_000) break;
    }
    if (!data) throw new Error("DevTools did not return a screenshot.");
    if (data.length > 180_000) {
      throw new Error("Attached Browser screenshot is too large for model input.");
    }
    return `data:image/jpeg;base64,${data}`;
  }

  private requireTarget(): AttachedBrowserTarget {
    if (!this.target || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Attached Browser is not connected.");
    }
    return this.target;
  }

  private requireElementReference(refIdValue: string): AttachedElementReference {
    const target = this.requireTarget();
    const refId = refIdValue.trim();
    const reference = this.elementReferences.get(refId);
    if (!/^element_[a-f0-9]{20}$/.test(refId) || !reference || reference.url !== target.url) {
      throw staleAttachedElementError();
    }
    return reference;
  }

  private elementActionResult(
    refId: string,
    rawUrlBefore: string,
    target: ManagedBrowserElementActionResult["target"]
  ): ManagedBrowserElementActionResult {
    const current = this.requireTarget();
    return {
      completed: true,
      pageId: current.targetId,
      refId,
      urlBefore: sanitizeAttachedUrl(rawUrlBefore),
      urlAfter: sanitizeAttachedUrl(current.url),
      navigated: current.url !== rawUrlBefore,
      target: {
        tag: String(target.tag || "").slice(0, 64),
        role: String(target.role || "").slice(0, 128),
        name: String(target.name || "").slice(0, 500),
        inputType: target.inputType === null ? null : String(target.inputType || "").slice(0, 64),
        x: Math.round(target.x),
        y: Math.round(target.y)
      }
    };
  }

  private async evaluate(expression: string): Promise<unknown> {
    const response = await this.request<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Attached Browser evaluation failed."
      );
    }
    return response.result?.value;
  }

  private request<TResult = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<TResult> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Attached Browser is not connected."));
    }
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools request timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve: (value) => resolve(value as TResult), reject, timer });
      socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private onMessage(raw: RawData): void {
    let message: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(raw.toString());
    } catch {
      this.onClosed(new Error("DevTools returned invalid JSON."));
      return;
    }
    if (typeof message.id !== "number") {
      if (message.method) this.onEvent(message.method, message.params ?? {});
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message ?? "DevTools request failed."));
    else pending.resolve(message.result);
  }

  private onEvent(method: string, params: Record<string, unknown>): void {
    if (method === "Runtime.consoleAPICalled") {
      const args = Array.isArray(params.args) ? params.args : [];
      const callFrames = asAttachedRecord(params.stackTrace)?.callFrames;
      const firstFrame = Array.isArray(callFrames) ? asAttachedRecord(callFrames[0]) : null;
      this.pushConsole({
        level: attachedConsoleLevel(params.type),
        message: args.map(attachedRemoteValue).join(" ").slice(0, 4_096),
        source: sanitizeAttachedUrl(String(firstFrame?.url ?? "")),
        line: attachedInteger(firstFrame?.lineNumber)
      });
      return;
    }
    if (method === "Runtime.exceptionThrown") {
      const details = asAttachedRecord(params.exceptionDetails);
      const exception = asAttachedRecord(details?.exception);
      this.pushConsole({
        level: "error",
        message: String(exception?.description ?? details?.text ?? "Uncaught exception").slice(0, 4_096),
        source: sanitizeAttachedUrl(String(details?.url ?? "")),
        line: attachedInteger(details?.lineNumber)
      });
      return;
    }
    if (method === "Network.requestWillBeSent") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const request = asAttachedRecord(params.request);
      if (!requestId || !request) return;
      const timestamp = attachedNumber(params.timestamp);
      if (timestamp !== null) this.networkStartTimes.set(requestId, timestamp);
      this.networkEntries.set(requestId, {
        requestId,
        pageId: this.target?.targetId ?? "attached",
        method: String(request.method ?? "GET").slice(0, 32),
        url: sanitizeAttachedUrl(String(request.url ?? "")),
        resourceType: String(params.type ?? "other").slice(0, 64),
        status: null,
        statusLine: null,
        mimeType: null,
        requestHeaders: sanitizeAttachedHeaders(asAttachedRecord(request.headers)),
        responseHeaders: {},
        fromCache: false,
        failed: false,
        error: null,
        startedAt: attachedWallTime(params.wallTime),
        finishedAt: null,
        durationMs: null
      });
      pruneAttachedNetwork(this.networkEntries, this.networkStartTimes);
      return;
    }
    if (method === "Network.responseReceived") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const response = asAttachedRecord(params.response);
      const existing = this.networkEntries.get(requestId);
      if (!requestId || !response || !existing) return;
      this.networkEntries.set(requestId, {
        ...existing,
        status: attachedNumber(response.status),
        statusLine: String(response.statusText ?? "").slice(0, 256) || null,
        mimeType: String(response.mimeType ?? "").slice(0, 256) || null,
        responseHeaders: sanitizeAttachedHeaders(asAttachedRecord(response.headers)),
        fromCache: response.fromDiskCache === true || response.fromPrefetchCache === true
      });
      return;
    }
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const existing = this.networkEntries.get(requestId);
      if (!requestId || !existing) return;
      const timestamp = attachedNumber(params.timestamp);
      const started = this.networkStartTimes.get(requestId);
      this.networkEntries.set(requestId, {
        ...existing,
        failed: method === "Network.loadingFailed",
        error: method === "Network.loadingFailed"
          ? String(params.errorText ?? "Network request failed").slice(0, 512)
          : null,
        finishedAt: new Date().toISOString(),
        durationMs: timestamp !== null && started !== undefined
          ? Math.max(0, Math.round((timestamp - started) * 1_000))
          : null
      });
      return;
    }
    if (method === "Page.frameNavigated") {
      const frame = asAttachedRecord(params.frame);
      if (frame && !frame.parentId && typeof frame.url === "string" && this.target) {
        this.target.url = frame.url;
        this.elementReferences.clear();
      }
      return;
    }
    if (method === "Page.navigatedWithinDocument") {
      if (typeof params.url === "string" && this.target) {
        this.target.url = params.url;
        this.elementReferences.clear();
      }
    }
  }

  private pushConsole(
    input: Pick<ManagedBrowserConsoleEntry, "level" | "message" | "source" | "line">
  ): void {
    this.consoleEntries.push({
      entryId: `console_${randomUUID().replaceAll("-", "")}`,
      pageId: this.target?.targetId ?? "attached",
      ...input,
      timestamp: new Date().toISOString()
    });
    if (this.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
      this.consoleEntries.splice(0, this.consoleEntries.length - MAX_CONSOLE_ENTRIES);
    }
  }

  private onClosed(error: Error): void {
    this.lastError = error.message;
    this.socket = null;
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function validateSelector(value: string): string {
  const selector = value.trim();
  if (!selector || selector.length > 2_048 || selector.includes("\0")) {
    throw new Error("Attached Browser selector is invalid.");
  }
  return selector;
}

function staleAttachedElementError(): Error {
  const error = new Error("Attached Browser element reference is stale; inspect the page again.");
  Object.assign(error, { code: "BROWSER_ELEMENT_REFERENCE_STALE" });
  return error;
}

function asAttachedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function attachedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function attachedInteger(value: unknown): number {
  const number = attachedNumber(value);
  return number === null ? 0 : Math.max(0, Math.floor(number));
}

function attachedWallTime(value: unknown): string {
  const seconds = attachedNumber(value);
  return seconds === null ? new Date().toISOString() : new Date(seconds * 1_000).toISOString();
}

function attachedConsoleLevel(value: unknown): ManagedBrowserConsoleEntry["level"] {
  if (value === "error" || value === "warning" || value === "debug") return value;
  if (value === "warn") return "warning";
  return "info";
}

function attachedRemoteValue(value: unknown): string {
  const record = asAttachedRecord(value);
  if (!record) return String(value ?? "");
  if (record.value !== undefined) {
    return typeof record.value === "string"
      ? record.value
      : JSON.stringify(record.value).slice(0, 2_048);
  }
  return String(record.description ?? record.type ?? "").slice(0, 2_048);
}

function sanitizeAttachedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|passwd|auth|session|code|key/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString().slice(0, 8_192);
  } catch {
    return value.slice(0, 8_192);
  }
}

function sanitizeAttachedHeaders(
  headers: Record<string, unknown> | null
): Record<string, string> {
  if (!headers) return {};
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers).slice(0, 50)) {
    const normalizedName = name.toLowerCase();
    output[normalizedName] = /authorization|cookie|token|secret|password|api[-_]?key/i.test(name)
      ? "[redacted]"
      : /^(?:location|referer|referrer|origin)$/.test(normalizedName)
        ? sanitizeAttachedUrl(String(value)).slice(0, 2_048)
        : String(value).slice(0, 2_048);
  }
  return output;
}

function pruneAttachedNetwork(
  entries: Map<string, ManagedBrowserNetworkEntry>,
  startTimes: Map<string, number>
): void {
  while (entries.size > MAX_NETWORK_ENTRIES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) break;
    entries.delete(oldest);
    startTimes.delete(oldest);
  }
}

function isAttachedTextualMimeType(value: string | null): boolean {
  if (!value) return true;
  return /^(?:text\/|application\/(?:json|.*\+json|javascript|xml|.*\+xml|x-www-form-urlencoded))/i
    .test(value);
}
