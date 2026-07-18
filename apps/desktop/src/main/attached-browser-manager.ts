import WebSocket, { type RawData } from "ws";
import { assertLocalDevToolsWebSocket, normalizeDevToolsEndpoint } from "./attached-browser-policy";

const MAX_DISCOVERY_BYTES = 1024 * 1024;
const MAX_EXTRACTED_TEXT = 1024 * 1024;

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
    socket.on("message", (data) => this.onMessage(data));
    socket.on("close", () => this.onClosed(new Error("Attached Browser disconnected.")));
    socket.on("error", (error) => this.onClosed(error));
    await Promise.all([
      this.request("Runtime.enable"),
      this.request("Page.enable")
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
    return this.state();
  }

  async navigate(url: string): Promise<AttachedBrowserState> {
    const normalized = new URL(url);
    if (!["http:", "https:"].includes(normalized.protocol) || normalized.username || normalized.password) {
      throw new Error("Attached Browser navigation requires a credential-free HTTP(S) URL.");
    }
    await this.request("Page.navigate", { url: normalized.toString() });
    if (this.target) this.target.url = normalized.toString();
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

  async screenshot(): Promise<string> {
    const result = await this.request<{ data?: string }>("Page.captureScreenshot", { format: "png" });
    if (!result.data) throw new Error("DevTools did not return a screenshot.");
    return `data:image/png;base64,${result.data}`;
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
    let message: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(raw.toString());
    } catch {
      this.onClosed(new Error("DevTools returned invalid JSON."));
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message ?? "DevTools request failed."));
    else pending.resolve(message.result);
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
