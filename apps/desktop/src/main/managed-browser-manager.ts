import { trMain } from "./i18n";
import { createHash, randomUUID } from "node:crypto";
import {
  WebContentsView,
  type BrowserWindow,
  type DownloadItem,
  type Event,
  type Rectangle,
  type Session,
  type WebContents
} from "electron";
import type {
  ManagedBrowserConsoleEntry,
  ManagedBrowserElementActionResult,
  ManagedBrowserInspection,
  ManagedBrowserNetworkBody,
  ManagedBrowserNetworkEntry,
  ManagedBrowserPerformance,
  ManagedBrowserDownload,
  ManagedBrowserOperationKind,
  ManagedBrowserOperationSource,
  ManagedBrowserPageSummary,
  ManagedBrowserProfile,
  ManagedBrowserProfileInput,
  ManagedBrowserState,
  ManagedBrowserUploadResult,
  ManagedBrowserWaitResult
} from "../shared/desktop-api";
import {
  allocateDownloadPath,
  prepareProjectDownloadDirectory,
  resolveProjectUploadFiles
} from "./managed-browser-files";
import { ManagedBrowserOperationStore } from "./managed-browser-operation-store";
import {
  DEFAULT_BROWSER_PROFILE_INPUT,
  browserPartition,
  normalizeBrowserProfileInput,
  workflowBrowserProfileId
} from "./managed-browser-profile";
import {
  assertSafeBrowserText,
  assertSafeSelector,
  normalizeBrowserUrl
} from "./managed-browser-policy";
import { SingleFlightByKey } from "./single-flight";

type BrowserPageRecord = {
  pageId: string;
  profileId: string;
  localProjectId: string;
  view: WebContentsView;
  loading: boolean;
  crashed: boolean;
  userTakeover: boolean;
  downloadDirectory: string | null;
  debuggerReady: boolean;
  debuggerListening: boolean;
  debuggerSetup: Promise<void> | null;
};

type SessionDownloadListener = (
  event: Event,
  item: DownloadItem,
  webContents: WebContents
) => void;

type BrowserElementReference = {
  refId: string;
  locator: string;
  url: string;
  inputType: string | null;
};

type ManagedBrowserManagerOptions = {
  resolveProjectRoot?(localProjectId: string): Promise<string>;
  dataScopeId?: string;
  onPersistentPartition?(partition: string): void;
};

const MAX_CONSOLE_ENTRIES_PER_PAGE = 200;
const MAX_NETWORK_ENTRIES_PER_PAGE = 300;
const MAX_OBSERVED_TEXT = 4_096;
const MANAGED_BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;

export type ManagedBrowserOperationContext = {
  source?: ManagedBrowserOperationSource;
  title?: string;
  retryOfOperationId?: string;
};

export type ManagedBrowserRetryDescriptor =
  | { kind: "navigate"; pageId?: string; value: string }
  | { kind: "back"; pageId?: string }
  | { kind: "forward"; pageId?: string }
  | { kind: "reload"; pageId?: string }
  | { kind: "takeover"; pageId?: string; value: boolean }
  | { kind: "click"; pageId?: string; selector: string }
  | { kind: "click_ref"; pageId?: string; refId: string }
  | { kind: "click_point"; pageId?: string; x: number; y: number }
  | { kind: "scroll"; pageId?: string; deltaX: number; deltaY: number }
  | { kind: "press"; pageId?: string; key: string; modifiers: string[] }
  | { kind: "type"; pageId?: string; selector: string; text: string }
  | { kind: "type_ref"; pageId?: string; refId: string; text: string }
  | { kind: "upload"; pageId?: string; selector: string; relativePaths: string[] }
  | { kind: "extract"; pageId?: string; selector: string }
  | { kind: "screenshot"; pageId?: string };

export class ManagedBrowserManager {
  private readonly profiles = new Map<string, ManagedBrowserProfile>();
  private readonly pages = new Map<string, BrowserPageRecord>();
  private readonly downloads = new Map<string, ManagedBrowserDownload>();
  private readonly operations = new ManagedBrowserOperationStore();
  private readonly operationRetries = new Map<string, ManagedBrowserRetryDescriptor>();
  private readonly consoleEntries = new Map<string, ManagedBrowserConsoleEntry[]>();
  private readonly networkEntries = new Map<string, Map<string, ManagedBrowserNetworkEntry>>();
  private readonly cdpRequestIds = new Map<string, Map<string, string>>();
  private readonly elementReferences = new Map<string, Map<string, BrowserElementReference>>();
  private readonly activePageByProject = new Map<string, string>();
  private readonly activePageByProfile = new Map<string, string>();
  private readonly activePageCreation = new SingleFlightByKey<BrowserPageRecord>();
  private readonly configuredSessions = new Map<Session, SessionDownloadListener>();
  private activeProjectId: string | null = null;
  private visible = false;
  private bounds: Rectangle = { x: 0, y: 0, width: 1, height: 1 };

  constructor(
    private readonly window: BrowserWindow,
    private readonly options: ManagedBrowserManagerOptions = {}
  ) {}

  async getState(localProjectId: string): Promise<ManagedBrowserState> {
    const page = await this.ensureActivePage(localProjectId);
    return this.stateFor(page);
  }

  async getPageState(localProjectId: string, pageId?: string): Promise<ManagedBrowserState> {
    return this.stateFor(await this.resolvePage(localProjectId, pageId));
  }

  async getWorkflowState(
    localProjectId: string,
    workflowId: string
  ): Promise<ManagedBrowserState> {
    const profile = this.ensureWorkflowProfile(localProjectId, workflowId);
    const page = await this.ensureProfileActivePage(profile);
    return this.stateFor(page, true);
  }

  async show(localProjectId: string, bounds: Rectangle): Promise<ManagedBrowserState> {
    this.bounds = sanitizeBounds(bounds);
    const page = await this.ensureActivePage(localProjectId);
    this.activeProjectId = localProjectId;
    this.visible = true;
    this.syncVisibility(page.pageId);
    return this.stateFor(page);
  }

  async showWorkflow(
    localProjectId: string,
    workflowId: string,
    bounds: Rectangle
  ): Promise<ManagedBrowserState> {
    this.bounds = sanitizeBounds(bounds);
    const profile = this.ensureWorkflowProfile(localProjectId, workflowId);
    const page = await this.ensureProfileActivePage(profile);
    this.activePageByProject.set(localProjectId, page.pageId);
    this.activeProjectId = localProjectId;
    this.visible = true;
    this.syncVisibility(page.pageId);
    return this.stateFor(page, true);
  }

  hide(): void {
    this.visible = false;
    for (const page of this.pages.values()) page.view.setVisible(false);
  }

  setBounds(bounds: Rectangle): void {
    this.bounds = sanitizeBounds(bounds);
    const page = this.currentVisiblePage();
    if (page) page.view.setBounds(this.bounds);
  }

  async createPage(
    localProjectId: string,
    profileId?: string,
    initialUrl = "about:blank"
  ): Promise<ManagedBrowserState> {
    const profile = profileId
      ? this.requireProfile(localProjectId, profileId)
      : this.ensureDefaultProfile(localProjectId);
    const page = await this.buildPage(profile);
    this.activePageByProject.set(localProjectId, page.pageId);
    this.activePageByProfile.set(profileKey(localProjectId, profile.profileId), page.pageId);
    if (this.activeProjectId === localProjectId && this.visible) this.syncVisibility(page.pageId);
    if (initialUrl !== "about:blank") await page.view.webContents.loadURL(normalizeBrowserUrl(initialUrl));
    return this.stateFor(page);
  }

  async selectPage(localProjectId: string, pageId: string): Promise<ManagedBrowserState> {
    const page = this.requirePage(localProjectId, pageId);
    this.activePageByProject.set(localProjectId, pageId);
    this.activePageByProfile.set(profileKey(localProjectId, page.profileId), pageId);
    if (this.activeProjectId === localProjectId && this.visible) this.syncVisibility(pageId);
    return this.stateFor(page);
  }

  async closePage(localProjectId: string, pageId: string): Promise<ManagedBrowserState> {
    const page = this.requirePage(localProjectId, pageId);
    const siblings = this.profilePages(localProjectId, page.profileId)
      .filter((candidate) => candidate.pageId !== pageId);
    let next = siblings[0];
    if (!next) {
      const profile = this.requireProfile(localProjectId, page.profileId);
      next = await this.buildPage(profile);
    }
    this.destroyPage(page);
    this.activePageByProject.set(localProjectId, next.pageId);
    this.activePageByProfile.set(profileKey(localProjectId, next.profileId), next.pageId);
    if (this.activeProjectId === localProjectId && this.visible) this.syncVisibility(next.pageId);
    return this.stateFor(next);
  }

  async createProfile(
    localProjectId: string,
    input: ManagedBrowserProfileInput
  ): Promise<ManagedBrowserState> {
    const profile: ManagedBrowserProfile = {
      profileId: `profile_${randomUUID().replaceAll("-", "")}`,
      localProjectId,
      ...normalizeBrowserProfileInput(input)
    };
    this.profiles.set(profileKey(localProjectId, profile.profileId), profile);
    return this.createPage(localProjectId, profile.profileId);
  }

  async updateProfile(
    localProjectId: string,
    profileId: string,
    input: ManagedBrowserProfileInput
  ): Promise<ManagedBrowserState> {
    const current = this.requireProfile(localProjectId, profileId);
    const normalized = normalizeBrowserProfileInput(input);
    if (current.persistence !== normalized.persistence && this.profilePages(localProjectId, profileId).length) {
      throw new Error("Close Profile pages before changing its persistence.");
    }
    const profile = { ...current, ...normalized };
    this.profiles.set(profileKey(localProjectId, profileId), profile);
    const pages = this.profilePages(localProjectId, profileId);
    if (pages.length) {
      const session = pages[0].view.webContents.session;
      await applyProxy(session, profile);
      for (const page of pages) applyUserAgent(page, profile.userAgent);
    }
    return this.getState(localProjectId);
  }

  async deleteProfile(localProjectId: string, profileId: string): Promise<ManagedBrowserState> {
    const projectProfiles = this.projectProfiles(localProjectId);
    if (projectProfiles.length <= 1) throw new Error("A project must keep at least one Browser Profile.");
    this.requireProfile(localProjectId, profileId);
    for (const page of this.profilePages(localProjectId, profileId)) this.destroyPage(page);
    this.profiles.delete(profileKey(localProjectId, profileId));
    const activePageId = this.activePageByProject.get(localProjectId);
    if (!activePageId || !this.pages.has(activePageId)) {
      const replacement = this.projectPages(localProjectId)[0];
      if (replacement) this.activePageByProject.set(localProjectId, replacement.pageId);
      else await this.createPage(localProjectId, this.projectProfiles(localProjectId)[0].profileId);
    }
    const state = await this.getState(localProjectId);
    if (this.activeProjectId === localProjectId && this.visible) this.syncVisibility(state.activePageId);
    return state;
  }

  async navigate(
    localProjectId: string,
    value: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserState> {
    return this.runOperation(
      localProjectId,
      { kind: "navigate", pageId, value },
      context,
      async (page) => {
        page.crashed = false;
        await loadManagedBrowserUrl(
          page.view.webContents,
          normalizeBrowserUrl(value),
          MANAGED_BROWSER_NAVIGATION_TIMEOUT_MS
        );
        return this.stateFor(page);
      }
    );
  }

  async back(
    localProjectId: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserState> {
    return this.runOperation(localProjectId, { kind: "back", pageId }, context, async (page) => {
      if (page.view.webContents.canGoBack()) page.view.webContents.goBack();
      return this.stateFor(page);
    });
  }

  async forward(
    localProjectId: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserState> {
    return this.runOperation(
      localProjectId,
      { kind: "forward", pageId },
      context,
      async (page) => {
        if (page.view.webContents.canGoForward()) page.view.webContents.goForward();
        return this.stateFor(page);
      }
    );
  }

  async reload(
    localProjectId: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserState> {
    return this.runOperation(
      localProjectId,
      { kind: "reload", pageId },
      context,
      async (page) => {
        page.view.webContents.reload();
        return this.stateFor(page);
      }
    );
  }

  async setUserTakeover(
    localProjectId: string,
    value: boolean,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserState> {
    return this.runOperation(
      localProjectId,
      { kind: "takeover", pageId, value },
      context,
      async (page) => {
        page.userTakeover = value;
        await this.applyInteractionMode(page);
        return this.stateFor(page);
      }
    );
  }

  async click(
    localProjectId: string,
    selectorValue: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<void> {
    return this.runOperation(
      localProjectId,
      { kind: "click", pageId, selector: selectorValue },
      context,
      async (page) => {
        const selector = assertSafeSelector(selectorValue);
        await page.view.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!(element instanceof HTMLElement)) throw new Error("Browser element not found");
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
        })()`);
      }
    );
  }

  async clickRef(
    localProjectId: string,
    refIdValue: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserElementActionResult> {
    return this.runOperation(
      localProjectId,
      { kind: "click_ref", pageId, refId: refIdValue },
      context,
      async (page) => {
        const reference = this.requireElementReference(page, refIdValue);
        const rawUrlBefore = page.view.webContents.getURL() || "about:blank";
        const target = await this.resolveReferencedElement(page, reference, "click");
        const bounds = page.view.getBounds();
        if (target.x < 0 || target.y < 0 || target.x >= bounds.width || target.y >= bounds.height) {
          throw new Error("Referenced browser element is outside the visible page.");
        }
        page.view.webContents.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y });
        page.view.webContents.sendInputEvent({
          type: "mouseDown",
          x: target.x,
          y: target.y,
          button: "left",
          clickCount: 1
        });
        page.view.webContents.sendInputEvent({
          type: "mouseUp",
          x: target.x,
          y: target.y,
          button: "left",
          clickCount: 1
        });
        const rawUrlAfter = page.view.webContents.getURL() || "about:blank";
        return {
          completed: true,
          pageId: page.pageId,
          refId: reference.refId,
          urlBefore: sanitizeObservedUrl(rawUrlBefore),
          urlAfter: sanitizeObservedUrl(rawUrlAfter),
          navigated: rawUrlAfter !== rawUrlBefore,
          target
        };
      }
    );
  }

  async clickPoint(
    localProjectId: string,
    xValue: number,
    yValue: number,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<void> {
    return this.runOperation(
      localProjectId,
      { kind: "click_point", pageId, x: xValue, y: yValue },
      context,
      async (page) => {
        const x = assertBrowserCoordinate(xValue, "x");
        const y = assertBrowserCoordinate(yValue, "y");
        const bounds = page.view.getBounds();
        if (x >= bounds.width || y >= bounds.height) {
          throw new Error("Browser click coordinates are outside the visible page.");
        }
        page.view.webContents.sendInputEvent({ type: "mouseMove", x, y });
        page.view.webContents.sendInputEvent({
          type: "mouseDown",
          x,
          y,
          button: "left",
          clickCount: 1
        });
        page.view.webContents.sendInputEvent({
          type: "mouseUp",
          x,
          y,
          button: "left",
          clickCount: 1
        });
      }
    );
  }

  async scroll(
    localProjectId: string,
    deltaXValue: number,
    deltaYValue: number,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<void> {
    return this.runOperation(
      localProjectId,
      { kind: "scroll", pageId, deltaX: deltaXValue, deltaY: deltaYValue },
      context,
      async (page) => {
        const deltaX = assertBrowserDelta(deltaXValue, "deltaX");
        const deltaY = assertBrowserDelta(deltaYValue, "deltaY");
        if (deltaX === 0 && deltaY === 0) {
          throw new Error("Browser scroll requires a non-zero delta.");
        }
        const bounds = page.view.getBounds();
        page.view.webContents.sendInputEvent({
          type: "mouseWheel",
          x: Math.max(0, Math.floor(bounds.width / 2)),
          y: Math.max(0, Math.floor(bounds.height / 2)),
          deltaX,
          deltaY,
          canScroll: true
        });
      }
    );
  }

  async press(
    localProjectId: string,
    keyValue: string,
    modifiersValue: string[] = [],
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<void> {
    return this.runOperation(
      localProjectId,
      { kind: "press", pageId, key: keyValue, modifiers: [...modifiersValue] },
      context,
      async (page) => {
        const keyCode = normalizeBrowserKey(keyValue);
        const modifiers = normalizeBrowserModifiers(modifiersValue);
        page.view.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
        if (keyCode.length === 1 && !modifiers.includes("control") && !modifiers.includes("meta")) {
          page.view.webContents.sendInputEvent({ type: "char", keyCode, modifiers });
        }
        page.view.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      }
    );
  }

  async type(
    localProjectId: string,
    selectorValue: string,
    textValue: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<void> {
    return this.runOperation(
      localProjectId,
      { kind: "type", pageId, selector: selectorValue, text: textValue },
      context,
      async (page) => {
        const selector = assertSafeSelector(selectorValue);
        const text = assertSafeBrowserText(textValue);
        const inputType = await page.view.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
            return { editable: false, inputType: null };
          }
          return {
            editable: true,
            inputType: element instanceof HTMLInputElement ? String(element.type || "text") : null
          };
        })()`) as { editable?: unknown; inputType?: unknown };
        if (inputType.editable !== true) throw new Error("Browser input not found");
        assertAgentBrowserInputAllowed(inputType.inputType);
        await page.view.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
            throw new Error("Browser input not found");
          }
          element.focus();
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
          if (setter) setter.call(element, ${JSON.stringify(text)});
          else element.value = ${JSON.stringify(text)};
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        })()`);
      }
    );
  }

  async typeRef(
    localProjectId: string,
    refIdValue: string,
    textValue: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserElementActionResult> {
    return this.runOperation(
      localProjectId,
      { kind: "type_ref", pageId, refId: refIdValue, text: textValue },
      context,
      async (page) => {
        const reference = this.requireElementReference(page, refIdValue);
        assertAgentBrowserInputAllowed(reference.inputType);
        const text = assertSafeBrowserText(textValue);
        const rawUrlBefore = page.view.webContents.getURL() || "about:blank";
        const target = await this.resolveReferencedElement(page, reference, "type", text);
        const rawUrlAfter = page.view.webContents.getURL() || "about:blank";
        return {
          completed: true,
          pageId: page.pageId,
          refId: reference.refId,
          urlBefore: sanitizeObservedUrl(rawUrlBefore),
          urlAfter: sanitizeObservedUrl(rawUrlAfter),
          navigated: rawUrlAfter !== rawUrlBefore,
          target
        };
      }
    );
  }

  async upload(
    localProjectId: string,
    selectorValue: string,
    relativePaths: string[],
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<ManagedBrowserUploadResult> {
    return this.runOperation(
      localProjectId,
      { kind: "upload", pageId, selector: selectorValue, relativePaths: [...relativePaths] },
      context,
      async (page) => {
        const selector = assertSafeSelector(selectorValue);
        const projectRoot = await this.resolveProjectRoot(localProjectId);
        const files = await resolveProjectUploadFiles(projectRoot, relativePaths);
        const isFileInput = await page.view.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          return element instanceof HTMLInputElement &&
            element.type.toLowerCase() === "file" &&
            !element.disabled;
        })()`);
        if (!isFileInput) throw new Error("Browser upload target is not an enabled file input.");

        const browserDebugger = page.view.webContents.debugger;
        const attachedHere = !browserDebugger.isAttached();
        if (attachedHere) browserDebugger.attach("1.3");
        try {
          const document = await browserDebugger.sendCommand("DOM.getDocument", {
            depth: 0,
            pierce: true
          }) as { root?: { nodeId?: number } };
          const rootNodeId = document.root?.nodeId;
          if (!rootNodeId) throw new Error("Browser document is unavailable.");
          const target = await browserDebugger.sendCommand("DOM.querySelector", {
            nodeId: rootNodeId,
            selector
          }) as { nodeId?: number };
          if (!target.nodeId) throw new Error("Browser upload input was not found.");
          await browserDebugger.sendCommand("DOM.setFileInputFiles", {
            files: files.absolutePaths,
            nodeId: target.nodeId
          });
        } finally {
          if (attachedHere && browserDebugger.isAttached()) browserDebugger.detach();
        }
        return {
          completed: true,
          pageId: page.pageId,
          url: page.view.webContents.getURL() || "about:blank",
          relativePaths: files.relativePaths
        };
      }
    );
  }

  async extract(
    localProjectId: string,
    selectorValue: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<string> {
    return this.runOperation(
      localProjectId,
      { kind: "extract", pageId, selector: selectorValue },
      context,
      async (page) => {
        const selector = assertSafeSelector(selectorValue);
        return page.view.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) throw new Error("Browser element not found");
          return (element.textContent || "").slice(0, 1000000);
        })()`);
      }
    );
  }

  async inspect(
    localProjectId: string,
    pageId?: string,
    maxElements = 200
  ): Promise<ManagedBrowserInspection> {
    const page = await this.resolvePage(localProjectId, pageId);
    const limit = Math.max(1, Math.min(500, Math.floor(maxElements)));
    const result = await page.view.webContents.executeJavaScript(browserInspectionScript(limit)) as {
      text?: unknown;
      elements?: unknown;
      truncated?: unknown;
    };
    const rawUrl = page.view.webContents.getURL() || "about:blank";
    const url = sanitizeObservedUrl(rawUrl);
    const references = new Map<string, BrowserElementReference>();
    const elements = Array.isArray(result.elements)
      ? (result.elements.slice(0, limit) as Array<Omit<ManagedBrowserInspection["elements"][number], "refId">>)
        .map((element) => {
          const locator = String(element.locator || "").slice(0, 4_096);
          const refId = `element_${createHash("sha256")
            .update(`${page.pageId}\0${rawUrl}\0${locator}`)
            .digest("hex")
            .slice(0, 20)}`;
          references.set(refId, {
            refId,
            locator,
            url: rawUrl,
            inputType: element.inputType === null ? null : String(element.inputType || "").slice(0, 64)
          });
          return {
            ...element,
            refId,
            locator,
            href: element.href ? sanitizeObservedUrl(element.href) : null
          };
        })
      : [];
    this.elementReferences.set(page.pageId, references);
    return {
      pageId: page.pageId,
      url,
      title: page.view.webContents.getTitle(),
      text: typeof result.text === "string" ? result.text.slice(0, 100_000) : "",
      elements,
      truncated: result.truncated === true
    };
  }

  async waitFor(
    localProjectId: string,
    condition: "load" | "selector" | "text",
    value: string | undefined,
    timeoutMs: number,
    pageId?: string
  ): Promise<ManagedBrowserWaitResult> {
    const page = await this.resolvePage(localProjectId, pageId);
    const startedAt = Date.now();
    const timeout = Math.max(100, Math.min(30_000, Math.floor(timeoutMs)));
    const expected = value?.trim() ?? "";
    if (condition !== "load" && !expected) {
      throw new Error(`Browser wait ${condition} value is required.`);
    }
    if (condition === "selector") assertSafeSelector(expected);

    while (Date.now() - startedAt <= timeout) {
      let matched = condition === "load" ? !page.loading : false;
      if (condition !== "load") {
        matched = await page.view.webContents.executeJavaScript(
          browserWaitScript(condition, expected)
        ) as boolean;
      }
      if (matched) {
        return {
          pageId: page.pageId,
          url: page.view.webContents.getURL() || "about:blank",
          condition,
          matched: true,
          elapsedMs: Date.now() - startedAt
        };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Browser wait timed out after ${timeout} ms.`);
  }

  async getConsole(
    localProjectId: string,
    pageId?: string,
    limit = 100
  ): Promise<ManagedBrowserConsoleEntry[]> {
    const page = await this.resolvePage(localProjectId, pageId);
    return (this.consoleEntries.get(page.pageId) ?? [])
      .slice(-Math.max(1, Math.min(MAX_CONSOLE_ENTRIES_PER_PAGE, Math.floor(limit))))
      .map((entry) => ({ ...entry }));
  }

  async getNetwork(
    localProjectId: string,
    pageId?: string,
    limit = 100
  ): Promise<ManagedBrowserNetworkEntry[]> {
    const page = await this.resolvePage(localProjectId, pageId);
    return [...(this.networkEntries.get(page.pageId)?.values() ?? [])]
      .slice(-Math.max(1, Math.min(MAX_NETWORK_ENTRIES_PER_PAGE, Math.floor(limit))))
      .map((entry) => ({ ...entry }));
  }

  async getNetworkBody(
    localProjectId: string,
    requestId: string,
    pageId?: string,
    maxCharacters = 100_000
  ): Promise<ManagedBrowserNetworkBody> {
    const page = await this.resolvePage(localProjectId, pageId);
    const entry = this.networkEntries.get(page.pageId)?.get(requestId);
    if (!entry) throw new Error("Browser network request was not found.");
    const cdpRequestId = this.cdpRequestIds.get(page.pageId)?.get(requestId);
    if (!cdpRequestId) {
      throw new Error("Browser response body is unavailable for this request.");
    }
    await this.ensurePageDebugger(page);
    const result = await page.view.webContents.debugger.sendCommand(
      "Network.getResponseBody",
      { requestId: cdpRequestId }
    ) as { body?: unknown; base64Encoded?: unknown };
    const rawBody = typeof result.body === "string" ? result.body : "";
    const encoded = result.base64Encoded === true;
    const textual = !encoded || isTextualMimeType(entry.mimeType);
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

  async getPerformance(
    localProjectId: string,
    pageId?: string
  ): Promise<ManagedBrowserPerformance> {
    const page = await this.resolvePage(localProjectId, pageId);
    const result = await page.view.webContents.executeJavaScript(
      browserPerformanceScript()
    ) as {
      timeOrigin?: unknown;
      navigationType?: unknown;
      timings?: Partial<ManagedBrowserPerformance["timings"]>;
      resources?: Partial<ManagedBrowserPerformance["resources"]>;
    };
    return {
      pageId: page.pageId,
      url: sanitizeObservedUrl(page.view.webContents.getURL() || "about:blank"),
      capturedAt: new Date().toISOString(),
      timeOrigin: finitePerformanceNumber(result.timeOrigin, 0),
      navigationType: String(result.navigationType || "unknown").slice(0, 64),
      timings: {
        responseStartMs: nullablePerformanceNumber(result.timings?.responseStartMs),
        responseEndMs: nullablePerformanceNumber(result.timings?.responseEndMs),
        domInteractiveMs: nullablePerformanceNumber(result.timings?.domInteractiveMs),
        domContentLoadedMs: nullablePerformanceNumber(result.timings?.domContentLoadedMs),
        loadEventMs: nullablePerformanceNumber(result.timings?.loadEventMs),
        firstPaintMs: nullablePerformanceNumber(result.timings?.firstPaintMs),
        firstContentfulPaintMs: nullablePerformanceNumber(
          result.timings?.firstContentfulPaintMs
        )
      },
      resources: {
        count: Math.max(0, Math.floor(finitePerformanceNumber(result.resources?.count, 0))),
        transferSize: Math.max(0, finitePerformanceNumber(result.resources?.transferSize, 0)),
        encodedBodySize: Math.max(0, finitePerformanceNumber(result.resources?.encodedBodySize, 0)),
        decodedBodySize: Math.max(0, finitePerformanceNumber(result.resources?.decodedBodySize, 0)),
        slowest: Array.isArray(result.resources?.slowest)
          ? result.resources.slowest.slice(0, 20).map((resource) => ({
              url: sanitizeObservedUrl(String(resource.url || "")),
              initiatorType: String(resource.initiatorType || "other").slice(0, 64),
              startTimeMs: Math.max(0, finitePerformanceNumber(resource.startTimeMs, 0)),
              durationMs: Math.max(0, finitePerformanceNumber(resource.durationMs, 0)),
              transferSize: Math.max(0, finitePerformanceNumber(resource.transferSize, 0)),
              encodedBodySize: Math.max(0, finitePerformanceNumber(resource.encodedBodySize, 0)),
              decodedBodySize: Math.max(0, finitePerformanceNumber(resource.decodedBodySize, 0))
            }))
          : []
      }
    };
  }

  async screenshot(
    localProjectId: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext,
    format: "png" | "agent" = "png"
  ): Promise<string> {
    return this.runOperation(
      localProjectId,
      { kind: "screenshot", pageId },
      context,
      async (page) => {
        const image = await page.view.webContents.capturePage();
        if (format === "png") return image.toDataURL();
        return agentScreenshotDataUrl(image);
      }
    );
  }

  getRetryDescriptor(
    localProjectId: string,
    operationId: string
  ): ManagedBrowserRetryDescriptor {
    const operation = this.operations.get(localProjectId, operationId);
    const descriptor = this.operationRetries.get(operationId);
    if (!operation || operation.status !== "failed" || !operation.retryable || !descriptor) {
      throw new Error("Managed Browser operation is not available for retry.");
    }
    return cloneRetryDescriptor(descriptor);
  }

  async retryOperation(
    localProjectId: string,
    operationId: string
  ): Promise<ManagedBrowserState> {
    const operation = this.operations.get(localProjectId, operationId);
    const descriptor = this.getRetryDescriptor(localProjectId, operationId);
    const context: ManagedBrowserOperationContext = {
      source: "user",
      title: trMain("ui.9a3e34e1ba9c", [operation?.title ?? operationTitle(descriptor.kind)]),
      retryOfOperationId: operationId
    };
    if (descriptor.kind === "navigate") {
      return this.navigate(localProjectId, descriptor.value, descriptor.pageId, context);
    }
    if (descriptor.kind === "back") {
      return this.back(localProjectId, descriptor.pageId, context);
    }
    if (descriptor.kind === "forward") {
      return this.forward(localProjectId, descriptor.pageId, context);
    }
    if (descriptor.kind === "reload") {
      return this.reload(localProjectId, descriptor.pageId, context);
    }
    if (descriptor.kind === "takeover") {
      return this.setUserTakeover(localProjectId, descriptor.value, descriptor.pageId, context);
    }
    if (descriptor.kind === "click") {
      await this.click(localProjectId, descriptor.selector, descriptor.pageId, context);
    } else if (descriptor.kind === "click_ref") {
      await this.clickRef(localProjectId, descriptor.refId, descriptor.pageId, context);
    } else if (descriptor.kind === "click_point") {
      await this.clickPoint(
        localProjectId,
        descriptor.x,
        descriptor.y,
        descriptor.pageId,
        context
      );
    } else if (descriptor.kind === "scroll") {
      await this.scroll(
        localProjectId,
        descriptor.deltaX,
        descriptor.deltaY,
        descriptor.pageId,
        context
      );
    } else if (descriptor.kind === "press") {
      await this.press(
        localProjectId,
        descriptor.key,
        descriptor.modifiers,
        descriptor.pageId,
        context
      );
    } else if (descriptor.kind === "type") {
      await this.type(
        localProjectId,
        descriptor.selector,
        descriptor.text,
        descriptor.pageId,
        context
      );
    } else if (descriptor.kind === "type_ref") {
      await this.typeRef(
        localProjectId,
        descriptor.refId,
        descriptor.text,
        descriptor.pageId,
        context
      );
    } else if (descriptor.kind === "upload") {
      await this.upload(
        localProjectId,
        descriptor.selector,
        descriptor.relativePaths,
        descriptor.pageId,
        context
      );
    } else if (descriptor.kind === "extract") {
      await this.extract(localProjectId, descriptor.selector, descriptor.pageId, context);
    } else {
      await this.screenshot(localProjectId, descriptor.pageId, context);
    }
    return this.getPageState(localProjectId, descriptor.pageId);
  }

  destroy(): void {
    for (const page of [...this.pages.values()]) this.destroyPage(page);
    for (const [session, listener] of this.configuredSessions) {
      session.removeListener("will-download", listener);
    }
    this.configuredSessions.clear();
  }

  private ensureDefaultProfile(localProjectId: string): ManagedBrowserProfile {
    const existing = this.profiles.get(profileKey(localProjectId, "profile_default"));
    if (existing) return existing;
    const profile: ManagedBrowserProfile = {
      profileId: "profile_default",
      localProjectId,
      ...DEFAULT_BROWSER_PROFILE_INPUT
    };
    this.profiles.set(profileKey(localProjectId, profile.profileId), profile);
    return profile;
  }

  private ensureWorkflowProfile(
    localProjectId: string,
    workflowId: string
  ): ManagedBrowserProfile {
    const profileId = workflowBrowserProfileId(workflowId);
    const key = profileKey(localProjectId, profileId);
    const existing = this.profiles.get(key);
    if (existing) return existing;
    const profile: ManagedBrowserProfile = {
      profileId,
      localProjectId,
      ...DEFAULT_BROWSER_PROFILE_INPUT,
      name: `Workflow · ${workflowId.trim().slice(0, 60)}`,
      persistence: "persistent"
    };
    this.profiles.set(key, profile);
    return profile;
  }

  private async ensureProfileActivePage(
    profile: ManagedBrowserProfile
  ): Promise<BrowserPageRecord> {
    const key = profileKey(profile.localProjectId, profile.profileId);
    const activePageId = this.activePageByProfile.get(key);
    const activePage = activePageId ? this.pages.get(activePageId) : undefined;
    if (activePage) return activePage;
    return this.activePageCreation.run(key, async () => {
      const currentPageId = this.activePageByProfile.get(key);
      const currentPage = currentPageId ? this.pages.get(currentPageId) : undefined;
      if (currentPage) return currentPage;
      const existing = this.profilePages(profile.localProjectId, profile.profileId)[0];
      if (existing) {
        this.activePageByProfile.set(key, existing.pageId);
        return existing;
      }
      const page = await this.buildPage(profile);
      this.activePageByProfile.set(key, page.pageId);
      return page;
    });
  }

  private async ensureActivePage(localProjectId: string): Promise<BrowserPageRecord> {
    const activePageId = this.activePageByProject.get(localProjectId);
    if (activePageId) {
      const activePage = this.pages.get(activePageId);
      if (activePage) return activePage;
    }
    return this.activePageCreation.run(localProjectId, async () => {
      const currentPageId = this.activePageByProject.get(localProjectId);
      const currentPage = currentPageId ? this.pages.get(currentPageId) : undefined;
      if (currentPage) return currentPage;
      const currentExisting = this.projectPages(localProjectId)[0];
      if (currentExisting) {
        this.activePageByProject.set(localProjectId, currentExisting.pageId);
        this.activePageByProfile.set(
          profileKey(localProjectId, currentExisting.profileId),
          currentExisting.pageId
        );
        return currentExisting;
      }
      const profile = this.ensureDefaultProfile(localProjectId);
      const page = await this.buildPage(profile);
      this.activePageByProject.set(localProjectId, page.pageId);
      this.activePageByProfile.set(profileKey(localProjectId, profile.profileId), page.pageId);
      return page;
    });
  }

  private async resolvePage(localProjectId: string, pageId?: string): Promise<BrowserPageRecord> {
    return pageId ? this.requirePage(localProjectId, pageId) : this.ensureActivePage(localProjectId);
  }

  private requireElementReference(
    page: BrowserPageRecord,
    refIdValue: string
  ): BrowserElementReference {
    const refId = refIdValue.trim();
    if (!/^element_[a-f0-9]{20}$/.test(refId)) {
      throw new Error("Browser element reference is invalid.");
    }
    const reference = this.elementReferences.get(page.pageId)?.get(refId);
    const currentUrl = page.view.webContents.getURL() || "about:blank";
    if (!reference || reference.url !== currentUrl) {
      const error = new Error("Browser element reference is stale; inspect the page again.");
      Object.assign(error, { code: "BROWSER_ELEMENT_REFERENCE_STALE" });
      throw error;
    }
    return reference;
  }

  private async resolveReferencedElement(
    page: BrowserPageRecord,
    reference: BrowserElementReference,
    action: "click" | "type",
    text?: string
  ): Promise<ManagedBrowserElementActionResult["target"]> {
    const target = await page.view.webContents.executeJavaScript(
      browserReferencedElementScript(reference.locator, action, text)
    ) as ManagedBrowserElementActionResult["target"] | null;
    if (!target) {
      const error = new Error("Browser element reference could not be resolved; inspect the page again.");
      Object.assign(error, { code: "BROWSER_ELEMENT_REFERENCE_STALE" });
      throw error;
    }
    return {
      tag: String(target.tag || "").slice(0, 64),
      role: String(target.role || "").slice(0, 128),
      name: String(target.name || "").slice(0, 500),
      inputType: target.inputType === null ? null : String(target.inputType || "").slice(0, 64),
      x: assertBrowserCoordinate(Math.round(target.x), "x"),
      y: assertBrowserCoordinate(Math.round(target.y), "y")
    };
  }

  private async buildPage(profile: ManagedBrowserProfile): Promise<BrowserPageRecord> {
    const pageId = `page_${randomUUID().replaceAll("-", "")}`;
    const partition = browserPartition(profile, this.options.dataScopeId);
    if (partition.startsWith("persist:")) this.options.onPersistentPartition?.(partition);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false
      }
    });
    const page: BrowserPageRecord = {
      pageId,
      profileId: profile.profileId,
      localProjectId: profile.localProjectId,
      view,
      loading: false,
      crashed: false,
      userTakeover: true,
      downloadDirectory: await this.prepareDownloadDirectory(profile.localProjectId),
      debuggerReady: false,
      debuggerListening: false,
      debuggerSetup: null
    };
    this.pages.set(pageId, page);
    this.window.contentView.addChildView(view);
    view.setBounds(this.bounds);
    view.setVisible(false);
    this.configureSession(view.webContents.session);
    await applyProxy(view.webContents.session, profile);
    applyUserAgent(page, profile.userAgent);
    view.webContents.setWindowOpenHandler(({ url }) => {
      void this.createPage(profile.localProjectId, profile.profileId, url);
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => preventUnsafeNavigation(event, url));
    view.webContents.on("will-redirect", (event, url) => preventUnsafeNavigation(event, url));
    view.webContents.on("did-start-loading", () => {
      page.loading = true;
      page.crashed = false;
      this.elementReferences.delete(page.pageId);
    });
    view.webContents.on("did-stop-loading", () => {
      page.loading = false;
      void this.applyInteractionMode(page);
    });
    view.webContents.on("render-process-gone", () => {
      page.loading = false;
      page.crashed = true;
    });
    view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      const levels = ["debug", "info", "warning", "error"] as const;
      const entries = this.consoleEntries.get(page.pageId) ?? [];
      entries.push({
        entryId: `console_${randomUUID().replaceAll("-", "")}`,
        pageId: page.pageId,
        level: levels[level] ?? "info",
        message: String(message).slice(0, MAX_OBSERVED_TEXT),
        source: String(sourceId ?? "").slice(0, 2_048),
        line: Number.isFinite(line) ? line : 0,
        timestamp: new Date().toISOString()
      });
      if (entries.length > MAX_CONSOLE_ENTRIES_PER_PAGE) {
        entries.splice(0, entries.length - MAX_CONSOLE_ENTRIES_PER_PAGE);
      }
      this.consoleEntries.set(page.pageId, entries);
    });
    await view.webContents.loadURL("about:blank");
    void this.ensurePageDebugger(page).catch(() => undefined);
    return page;
  }

  private configureSession(session: Session): void {
    if (this.configuredSessions.has(session)) return;
    const handleDownload: SessionDownloadListener = (event, item, webContents) => {
      const page = [...this.pages.values()].find(
        (candidate) => candidate.view.webContents.id === webContents.id
      );
      if (!page?.downloadDirectory) {
        event.preventDefault();
        return;
      }
      const downloadId = `download_${randomUUID().replaceAll("-", "")}`;
      const allocated = allocateDownloadPath(
        page.downloadDirectory,
        item.getFilename(),
        new Set(
          [...this.downloads.values()]
            .filter((download) => download.localProjectId === page.localProjectId)
            .map((download) => download.fileName)
        )
      );
      const download: ManagedBrowserDownload = {
        downloadId,
        pageId: page.pageId,
        localProjectId: page.localProjectId,
        url: item.getURL(),
        fileName: allocated.fileName,
        relativePath: `.routemarket/downloads/${allocated.fileName}`,
        status: "progressing",
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        startedAt: new Date().toISOString(),
        finishedAt: null
      };
      this.downloads.set(downloadId, download);
      item.setSavePath(allocated.absolutePath);
      item.on("updated", (_downloadEvent, state) => {
        download.status = item.isPaused()
          ? "paused"
          : state === "interrupted"
            ? "interrupted"
            : "progressing";
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
      });
      item.once("done", (_downloadEvent, state) => {
        download.status = state;
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        download.finishedAt = new Date().toISOString();
      });
    };
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.on("will-download", handleDownload);
    session.webRequest.onBeforeRequest((details, callback) => {
      try {
        const page = this.pageForWebContentsId(details.webContentsId);
        if (page) {
          const entries = this.networkEntries.get(page.pageId) ?? new Map();
          const requestId = String(details.id);
          entries.set(requestId, {
            requestId,
            pageId: page.pageId,
            method: String(details.method || "GET").slice(0, 32),
            url: sanitizeObservedUrl(details.url),
            resourceType: String(details.resourceType ?? "other").slice(0, 64),
            status: null,
            statusLine: null,
            mimeType: null,
            requestHeaders: {},
            responseHeaders: {},
            fromCache: false,
            failed: false,
            error: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            durationMs: null
          });
          pruneNetworkEntries(entries);
          this.networkEntries.set(page.pageId, entries);
        }
      } finally {
        callback({});
      }
    });
    session.webRequest.onSendHeaders((details) => {
      this.updateNetworkEntry(details.webContentsId, String(details.id), {
        requestHeaders: sanitizeObservedHeaders(details.requestHeaders)
      });
    });
    session.webRequest.onResponseStarted((details) => {
      this.updateNetworkEntry(details.webContentsId, String(details.id), {
        status: details.statusCode,
        statusLine: String(details.statusLine || "").slice(0, 256) || null,
        mimeType: safeResponseHeader(details.responseHeaders, "content-type"),
        responseHeaders: sanitizeObservedHeaders(details.responseHeaders),
        fromCache: details.fromCache
      });
    });
    session.webRequest.onCompleted((details) => {
      this.finishNetworkEntry(details.webContentsId, String(details.id), {
        status: details.statusCode,
        statusLine: String(details.statusLine || "").slice(0, 256) || null,
        mimeType: safeResponseHeader(details.responseHeaders, "content-type"),
        fromCache: details.fromCache,
        failed: false,
        error: null
      });
    });
    session.webRequest.onErrorOccurred((details) => {
      this.finishNetworkEntry(details.webContentsId, String(details.id), {
        status: null,
        statusLine: null,
        mimeType: null,
        fromCache: false,
        failed: true,
        error: String(details.error || "Network request failed").slice(0, 512)
      });
    });
    this.configuredSessions.set(session, handleDownload);
  }

  private pageForWebContentsId(webContentsId: number | undefined): BrowserPageRecord | null {
    if (webContentsId === undefined) return null;
    return [...this.pages.values()].find(
      (page) => page.view.webContents.id === webContentsId
    ) ?? null;
  }

  private finishNetworkEntry(
    webContentsId: number | undefined,
    requestId: string,
    result: Pick<
      ManagedBrowserNetworkEntry,
      "status" | "statusLine" | "mimeType" | "fromCache" | "failed" | "error"
    >
  ): void {
    const page = this.pageForWebContentsId(webContentsId);
    if (!page) return;
    const entries = this.networkEntries.get(page.pageId) ?? new Map();
    const existing = entries.get(requestId);
    const finishedAt = new Date();
    entries.set(requestId, {
      ...(existing ?? {
        requestId,
        pageId: page.pageId,
        method: "GET",
        url: "",
        resourceType: "other",
        requestHeaders: {},
        responseHeaders: {},
        startedAt: finishedAt.toISOString()
      }),
      requestId,
      pageId: page.pageId,
      ...result,
      finishedAt: finishedAt.toISOString(),
      durationMs: existing
        ? Math.max(0, finishedAt.getTime() - Date.parse(existing.startedAt))
        : 0
    });
    pruneNetworkEntries(entries);
    this.networkEntries.set(page.pageId, entries);
  }

  private updateNetworkEntry(
    webContentsId: number | undefined,
    requestId: string,
    patch: Partial<ManagedBrowserNetworkEntry>
  ): void {
    const page = this.pageForWebContentsId(webContentsId);
    if (!page) return;
    const entries = this.networkEntries.get(page.pageId);
    const existing = entries?.get(requestId);
    if (!entries || !existing) return;
    entries.set(requestId, { ...existing, ...patch, requestId, pageId: page.pageId });
  }

  private async ensurePageDebugger(page: BrowserPageRecord): Promise<void> {
    if (page.debuggerReady) return;
    if (page.debuggerSetup) return page.debuggerSetup;
    const setup = this.initializePageDebugger(page);
    page.debuggerSetup = setup;
    try {
      await setup;
    } finally {
      if (page.debuggerSetup === setup) page.debuggerSetup = null;
    }
  }

  private async initializePageDebugger(page: BrowserPageRecord): Promise<void> {
    const browserDebugger = page.view.webContents.debugger;
    if (!page.debuggerListening) {
      browserDebugger.on("message", (_event, method, params) => {
        this.handleDebuggerMessage(page, method, params);
      });
      browserDebugger.on("detach", () => {
        page.debuggerReady = false;
      });
      page.debuggerListening = true;
    }
    if (!browserDebugger.isAttached()) browserDebugger.attach("1.3");
    await browserDebugger.sendCommand("Network.enable", {
      maxTotalBufferSize: 20 * 1024 * 1024,
      maxResourceBufferSize: 2 * 1024 * 1024
    });
    page.debuggerReady = true;
  }

  private handleDebuggerMessage(
    page: BrowserPageRecord,
    method: string,
    params: unknown
  ): void {
    if (method !== "Network.responseReceived" || !params || typeof params !== "object") return;
    const payload = params as Record<string, unknown>;
    const response = payload.response;
    if (!response || typeof response !== "object" || typeof payload.requestId !== "string") return;
    const responseRecord = response as Record<string, unknown>;
    if (typeof responseRecord.url !== "string") return;
    const url = sanitizeObservedUrl(responseRecord.url);
    const entries = this.networkEntries.get(page.pageId);
    if (!entries) return;
    const existingRequestIds = this.cdpRequestIds.get(page.pageId);
    const matching = [...entries.values()].reverse().find((entry) =>
      entry.url === url && (
        existingRequestIds?.get(entry.requestId) === payload.requestId ||
        !existingRequestIds?.has(entry.requestId)
      )
    );
    if (!matching) return;
    const requestIds = this.cdpRequestIds.get(page.pageId) ?? new Map<string, string>();
    requestIds.set(matching.requestId, payload.requestId);
    this.cdpRequestIds.set(page.pageId, requestIds);
  }

  private syncVisibility(activePageId: string): void {
    for (const page of this.pages.values()) {
      const shouldShow = this.visible
        && page.localProjectId === this.activeProjectId
        && page.pageId === activePageId;
      page.view.setVisible(shouldShow);
      if (shouldShow) page.view.setBounds(this.bounds);
    }
  }

  private currentVisiblePage(): BrowserPageRecord | null {
    if (!this.activeProjectId) return null;
    const pageId = this.activePageByProject.get(this.activeProjectId);
    return pageId ? this.pages.get(pageId) ?? null : null;
  }

  private stateFor(page: BrowserPageRecord, workflowScoped = false): ManagedBrowserState {
    const profilePages = this.profilePages(page.localProjectId, page.profileId);
    const pageIds = new Set(profilePages.map((candidate) => candidate.pageId));
    return {
      localProjectId: page.localProjectId,
      visible: this.visible && this.activeProjectId === page.localProjectId,
      activeProfileId: page.profileId,
      activePageId: page.pageId,
      url: page.view.webContents.getURL() || "about:blank",
      title: page.view.webContents.getTitle(),
      loading: page.loading,
      canGoBack: page.view.webContents.canGoBack(),
      canGoForward: page.view.webContents.canGoForward(),
      userTakeover: page.userTakeover,
      crashed: page.crashed,
      profiles: workflowScoped
        ? [this.requireProfile(page.localProjectId, page.profileId)]
        : this.projectProfiles(page.localProjectId),
      pages: profilePages.map(browserPageSummary),
      downloads: [...this.downloads.values()]
        .filter((download) =>
          download.localProjectId === page.localProjectId && pageIds.has(download.pageId))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
      operations: this.operations.list(page.localProjectId)
        .filter((operation) => pageIds.has(operation.pageId))
    };
  }

  private async runOperation<TResult>(
    localProjectId: string,
    descriptor: ManagedBrowserRetryDescriptor,
    context: ManagedBrowserOperationContext | undefined,
    task: (page: BrowserPageRecord) => Promise<TResult>
  ): Promise<TResult> {
    const requestedPage = descriptor.pageId
      ? this.pages.get(descriptor.pageId)
      : this.activePageByProject.get(localProjectId)
        ? this.pages.get(this.activePageByProject.get(localProjectId)!)
        : undefined;
    const operation = this.operations.begin({
      localProjectId,
      pageId: descriptor.pageId ?? requestedPage?.pageId ?? "active",
      source: context?.source ?? "user",
      kind: descriptor.kind,
      title: context?.title ?? operationTitle(descriptor.kind),
      detail: operationDetail(descriptor),
      url: requestedPage?.view.webContents.getURL() || "about:blank",
      retryable: true,
      retryOfOperationId: context?.retryOfOperationId ?? null
    });
    this.operationRetries.set(operation.operationId, cloneRetryDescriptor(descriptor));
    this.pruneOperationRetries();
    try {
      const page = await this.resolvePage(localProjectId, descriptor.pageId);
      this.operations.attachPage(
        operation.operationId,
        page.pageId,
        page.view.webContents.getURL() || "about:blank"
      );
      const result = await task(page);
      this.operations.succeed(
        operation.operationId,
        page.view.webContents.getURL() || "about:blank"
      );
      this.operationRetries.delete(operation.operationId);
      return result;
    } catch (error) {
      this.operations.fail(operation.operationId, error);
      throw error;
    }
  }

  private pruneOperationRetries(): void {
    for (const operationId of this.operationRetries.keys()) {
      if (!this.operations.has(operationId)) this.operationRetries.delete(operationId);
    }
  }

  private projectProfiles(localProjectId: string): ManagedBrowserProfile[] {
    return [...this.profiles.values()].filter((profile) => profile.localProjectId === localProjectId);
  }

  private projectPages(localProjectId: string): BrowserPageRecord[] {
    return [...this.pages.values()].filter((page) => page.localProjectId === localProjectId);
  }

  private profilePages(localProjectId: string, profileId: string): BrowserPageRecord[] {
    return this.projectPages(localProjectId).filter((page) => page.profileId === profileId);
  }

  private requireProfile(localProjectId: string, profileId: string): ManagedBrowserProfile {
    const profile = this.profiles.get(profileKey(localProjectId, profileId));
    if (!profile) throw new Error("Browser Profile not found.");
    return profile;
  }

  private requirePage(localProjectId: string, pageId: string): BrowserPageRecord {
    const page = this.pages.get(pageId);
    if (!page || page.localProjectId !== localProjectId) throw new Error("Browser page not found.");
    return page;
  }

  private destroyPage(page: BrowserPageRecord): void {
    page.view.setVisible(false);
    this.window.contentView.removeChildView(page.view);
    page.view.webContents.close();
    this.pages.delete(page.pageId);
    this.consoleEntries.delete(page.pageId);
    this.networkEntries.delete(page.pageId);
    this.cdpRequestIds.delete(page.pageId);
    this.elementReferences.delete(page.pageId);
    const key = profileKey(page.localProjectId, page.profileId);
    if (this.activePageByProfile.get(key) === page.pageId) {
      this.activePageByProfile.delete(key);
    }
  }

  private async applyInteractionMode(page: BrowserPageRecord): Promise<void> {
    if (page.view.webContents.isDestroyed() || !page.view.webContents.getURL()) return;
    await page.view.webContents.executeJavaScript(
      `document.documentElement.style.pointerEvents = ${JSON.stringify(page.userTakeover ? "auto" : "none")}`
    ).catch(() => undefined);
  }

  private async resolveProjectRoot(localProjectId: string): Promise<string> {
    if (!this.options.resolveProjectRoot) {
      throw new Error("Managed Browser project file access is unavailable.");
    }
    return this.options.resolveProjectRoot(localProjectId);
  }

  private async prepareDownloadDirectory(localProjectId: string): Promise<string | null> {
    if (!this.options.resolveProjectRoot) return null;
    return prepareProjectDownloadDirectory(
      await this.options.resolveProjectRoot(localProjectId)
    );
  }
}

function profileKey(localProjectId: string, profileId: string): string {
  return `${localProjectId}:${profileId}`;
}

function browserPageSummary(page: BrowserPageRecord): ManagedBrowserPageSummary {
  return {
    pageId: page.pageId,
    profileId: page.profileId,
    localProjectId: page.localProjectId,
    title: page.view.webContents.getTitle(),
    url: page.view.webContents.getURL() || "about:blank",
    loading: page.loading,
    crashed: page.crashed
  };
}

function applyUserAgent(page: BrowserPageRecord, userAgent: string): void {
  if (userAgent) page.view.webContents.setUserAgent(userAgent);
  else page.view.webContents.setUserAgent("");
}

async function applyProxy(session: Session, profile: ManagedBrowserProfile): Promise<void> {
  await session.setProxy(profile.proxyRules
    ? {
        mode: "fixed_servers",
        proxyRules: profile.proxyRules,
        proxyBypassRules: profile.proxyBypassRules
      }
    : { mode: "direct" });
  await session.closeAllConnections();
}

function preventUnsafeNavigation(event: Event, url: string): void {
  try {
    normalizeBrowserUrl(url);
  } catch {
    event.preventDefault();
  }
}

function sanitizeBounds(value: Rectangle): Rectangle {
  return {
    x: Math.max(0, Math.floor(value.x)),
    y: Math.max(0, Math.floor(value.y)),
    width: Math.max(1, Math.floor(value.width)),
    height: Math.max(1, Math.floor(value.height))
  };
}

function operationTitle(kind: ManagedBrowserOperationKind): string {
  const titles: Record<ManagedBrowserOperationKind, string> = {
    navigate: trMain("ui.22d040b33dbe"),
    back: trMain("ui.4cf4c11a1b0b"),
    forward: trMain("ui.320ffeefca2c"),
    reload: trMain("ui.75585e9bbca0"),
    takeover: trMain("ui.e8260c135b8e"),
    click: trMain("ui.21c2547386d0"),
    click_ref: "Click referenced browser element",
    click_point: "Click browser coordinates",
    scroll: "Scroll browser page",
    press: "Press browser key",
    type: trMain("ui.7b93ef577697"),
    type_ref: "Type into referenced browser element",
    upload: trMain("ui.a40b283a86f3"),
    extract: trMain("ui.074c72c437c6"),
    screenshot: trMain("ui.963479826cf8")
  };
  return titles[kind];
}

function operationDetail(descriptor: ManagedBrowserRetryDescriptor): string {
  if (descriptor.kind === "navigate") return descriptor.value;
  if (descriptor.kind === "takeover") {
    return descriptor.value ? trMain("ui.d73de59bf81e") : trMain("ui.f04c0211c92f");
  }
  if (
    descriptor.kind === "click" ||
    descriptor.kind === "type" ||
    descriptor.kind === "extract"
  ) {
    return descriptor.selector;
  }
  if (descriptor.kind === "click_point") return `${descriptor.x}, ${descriptor.y}`;
  if (descriptor.kind === "click_ref" || descriptor.kind === "type_ref") {
    return descriptor.refId;
  }
  if (descriptor.kind === "scroll") return `${descriptor.deltaX}, ${descriptor.deltaY}`;
  if (descriptor.kind === "press") {
    return [...descriptor.modifiers, descriptor.key].join("+");
  }
  if (descriptor.kind === "upload") {
    return trMain("ui.1f9b94ec2ee8", [descriptor.selector, descriptor.relativePaths.length]);
  }
  if (descriptor.kind === "back") return trMain("ui.b14f0fab768a");
  if (descriptor.kind === "forward") return trMain("ui.705ebd023a30");
  if (descriptor.kind === "reload") return trMain("ui.7ad6eb0c3a1b");
  return trMain("ui.b2e23403971b");
}

function assertBrowserCoordinate(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new Error(`Browser ${name} coordinate must be an integer between 0 and 100000.`);
  }
  return value;
}

function assertBrowserDelta(value: number, name: string): number {
  if (!Number.isInteger(value) || value < -100_000 || value > 100_000) {
    throw new Error(`Browser ${name} must be an integer between -100000 and 100000.`);
  }
  return value;
}

function normalizeBrowserKey(value: string): string {
  const key = value.trim();
  const named = new Set([
    "Enter", "Tab", "Escape", "Backspace", "Delete", "Space", "Home", "End",
    "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
  ]);
  if (key.length === 1 || named.has(key) || /^F(?:[1-9]|1[0-2])$/.test(key)) return key;
  throw new Error("Browser key is not supported.");
}

function normalizeBrowserModifiers(
  values: string[]
): Array<"shift" | "control" | "alt" | "meta"> {
  const allowed = new Set(["shift", "control", "alt", "meta"]);
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  if (normalized.some((value) => !allowed.has(value))) {
    throw new Error("Browser key modifiers must be shift, control, alt or meta.");
  }
  return normalized as Array<"shift" | "control" | "alt" | "meta">;
}

function pruneNetworkEntries(entries: Map<string, ManagedBrowserNetworkEntry>): void {
  while (entries.size > MAX_NETWORK_ENTRIES_PER_PAGE) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) break;
    entries.delete(oldest);
  }
}

export function sanitizeObservedUrl(value: string): string {
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

export function isUsableBrowserNavigationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function loadManagedBrowserUrl(
  webContents: WebContents,
  targetUrl: string,
  timeoutMs: number
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const loadResult = webContents.loadURL(targetUrl).then(
    () => ({ kind: "loaded" as const }),
    (error: unknown) => ({ kind: "error" as const, error })
  );
  const timeoutResult = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    timer.unref();
  });
  const result = await Promise.race([loadResult, timeoutResult]);
  if (timer) clearTimeout(timer);
  if (result.kind === "loaded") return;

  const currentUrl = webContents.getURL();
  if (isUsableBrowserNavigationUrl(currentUrl)) {
    webContents.stop();
    return;
  }
  if (result.kind === "error") throw result.error;
  throw new Error(`Browser navigation timed out after ${timeoutMs} ms while loading '${targetUrl}'.`);
}

function safeResponseHeader(
  headers: Record<string, string[]> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1]?.join(", ").slice(0, 256) ?? null;
}

export function sanitizeObservedHeaders(
  headers: Record<string, string | string[]> | undefined
): Record<string, string> {
  if (!headers) return {};
  const output: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(headers).slice(0, 50)) {
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
    const normalizedName = name.toLowerCase();
    output[normalizedName] = /authorization|cookie|token|secret|password|api[-_]?key/i.test(name)
      ? "[redacted]"
      : /^(?:location|referer|referrer|origin)$/.test(normalizedName)
        ? sanitizeObservedUrl(String(value)).slice(0, 2_048)
        : String(value).slice(0, 2_048);
  }
  return output;
}

function isTextualMimeType(value: string | null): boolean {
  if (!value) return true;
  return /^(?:text\/|application\/(?:json|.*\+json|javascript|xml|.*\+xml|x-www-form-urlencoded))/i
    .test(value);
}

function finitePerformanceNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullablePerformanceNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function browserPerformanceScript(): string {
  return `(() => {
    const number = (value) => Number.isFinite(value) && value >= 0 ? value : null;
    const navigation = performance.getEntriesByType("navigation")[0] || null;
    const paints = Object.fromEntries(
      performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime])
    );
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      url: String(entry.name || ""),
      initiatorType: String(entry.initiatorType || "other"),
      startTimeMs: number(entry.startTime) || 0,
      durationMs: number(entry.duration) || 0,
      transferSize: number(entry.transferSize) || 0,
      encodedBodySize: number(entry.encodedBodySize) || 0,
      decodedBodySize: number(entry.decodedBodySize) || 0
    }));
    return {
      timeOrigin: number(performance.timeOrigin) || 0,
      navigationType: String(navigation?.type || "unknown"),
      timings: {
        responseStartMs: number(navigation?.responseStart),
        responseEndMs: number(navigation?.responseEnd),
        domInteractiveMs: number(navigation?.domInteractive),
        domContentLoadedMs: number(navigation?.domContentLoadedEventEnd),
        loadEventMs: number(navigation?.loadEventEnd),
        firstPaintMs: number(paints["first-paint"]),
        firstContentfulPaintMs: number(paints["first-contentful-paint"])
      },
      resources: {
        count: resources.length,
        transferSize: resources.reduce((total, entry) => total + entry.transferSize, 0),
        encodedBodySize: resources.reduce((total, entry) => total + entry.encodedBodySize, 0),
        decodedBodySize: resources.reduce((total, entry) => total + entry.decodedBodySize, 0),
        slowest: resources.sort((left, right) => right.durationMs - left.durationMs).slice(0, 20)
      }
    };
  })()`;
}

export function browserReferencedElementScript(
  locator: string,
  action: "click" | "type",
  text?: string
): string {
  return `(() => {
    const locator = ${JSON.stringify(locator)};
    const action = ${JSON.stringify(action)};
    const text = ${JSON.stringify(text ?? "")};
    const parts = locator.split(' >>> ').filter(Boolean);
    if (!parts.length || parts.length > 12) return null;
    let root = document;
    let element = null;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isShadow = part.endsWith('::shadow');
      const isFrame = part.endsWith('::frame');
      const selector = isShadow
        ? part.slice(0, -'::shadow'.length)
        : isFrame ? part.slice(0, -'::frame'.length) : part;
      try { element = root.querySelector(selector); } catch { return null; }
      if (!element) return null;
      if (isShadow) {
        if (!element.shadowRoot) return null;
        root = element.shadowRoot;
      } else if (isFrame) {
        try {
          if (!element.contentDocument) return null;
          root = element.contentDocument;
        } catch { return null; }
      } else if (index !== parts.length - 1) {
        return null;
      }
    }
    if (!element || element.nodeType !== 1) return null;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return null;
    if ('disabled' in element && element.disabled) throw new Error('Referenced browser element is disabled');
    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (action === 'type') {
      const tag = element.tagName.toLowerCase();
      const editable = element.getAttribute('contenteditable') === 'true';
      if (tag !== 'input' && tag !== 'textarea' && !editable) {
        throw new Error('Referenced browser element is not editable');
      }
      if (tag === 'input' && String(element.type || 'text').toLowerCase() === 'password') {
        throw new Error('Password entry requires user takeover');
      }
      element.focus();
      if (editable) {
        element.textContent = text;
      } else {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
        if (setter) setter.call(element, text);
        else element.value = text;
      }
      const EventCtor = element.ownerDocument.defaultView?.Event || Event;
      element.dispatchEvent(new EventCtor('input', { bubbles: true }));
      element.dispatchEvent(new EventCtor('change', { bubbles: true }));
    }
    const rect = element.getBoundingClientRect();
    let x = rect.x + rect.width / 2;
    let y = rect.y + rect.height / 2;
    let ownerWindow = element.ownerDocument.defaultView;
    while (ownerWindow && ownerWindow !== window) {
      const frame = ownerWindow.frameElement;
      if (!frame) return null;
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.x;
      y += frameRect.y;
      ownerWindow = frame.ownerDocument.defaultView;
    }
    const name = element.getAttribute('aria-label') || element.getAttribute('alt') ||
      element.getAttribute('title') || element.getAttribute('placeholder') ||
      (element.textContent || '').trim();
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || '',
      name: String(name || '').slice(0, 500),
      inputType: element.tagName.toLowerCase() === 'input' ? String(element.type || 'text') : null,
      x: Math.round(x),
      y: Math.round(y)
    };
  })()`;
}

export function assertAgentBrowserInputAllowed(inputType: unknown): void {
  if (String(inputType ?? "").trim().toLowerCase() !== "password") return;
  const error = new Error(
    "Password entry requires user takeover. Ask the user to sign in directly in the Managed Browser."
  );
  Object.assign(error, { code: "BROWSER_USER_LOGIN_REQUIRED" });
  throw error;
}

export function browserInspectionScript(maxElements: number): string {
  return `(() => {
    const limit = ${maxElements};
    const selectorFor = (element) => {
      if (element.id) return '#' + CSS.escape(element.id);
      for (const attribute of ['data-testid', 'data-test', 'data-qa']) {
        const value = element.getAttribute(attribute);
        if (value) return element.tagName.toLowerCase() + '[' + attribute + '="' + CSS.escape(value) + '"]';
      }
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
          : [];
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const elements = [];
    const textParts = [];
    const visit = (root, boundaries, offsetX, offsetY) => {
      if (!root || elements.length > limit) return;
      const rootText = root.nodeType === 9 ? root.body?.innerText : root.textContent;
      if (rootText) textParts.push(rootText);
      const candidates = Array.from(root.querySelectorAll(
        'a,button,input,textarea,select,summary,iframe,[role],[contenteditable="true"],[tabindex]'
      ));
      for (const element of candidates) {
        if (elements.length > limit) break;
        const rect = element.getBoundingClientRect();
        const style = element.ownerDocument.defaultView?.getComputedStyle(element);
        if (!style) continue;
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') {
          continue;
        }
        const selector = selectorFor(element).slice(0, 2048);
        const tag = element.tagName.toLowerCase();
        const isInput = tag === 'input';
        const name = element.getAttribute('aria-label') || element.getAttribute('alt') ||
          element.getAttribute('title') || element.getAttribute('placeholder') ||
          (element.textContent || '').trim();
        const context = boundaries.some((part) => part.kind === 'frame')
          ? 'frame'
          : boundaries.some((part) => part.kind === 'shadow') ? 'shadow' : 'document';
        elements.push({
          index: elements.length,
          tag,
          role: element.getAttribute('role') || '',
          name: name.slice(0, 500),
          text: (element.textContent || '').trim().slice(0, 1000),
          selector,
          locator: [...boundaries.map((part) => part.label), selector].join(' >>> ').slice(0, 4096),
          context,
          inputType: isInput ? String(element.type || 'text') : null,
          href: tag === 'a' ? String(element.href || '').slice(0, 8192) : null,
          disabled: 'disabled' in element ? Boolean(element.disabled) : false,
          checked: isInput && ['checkbox', 'radio'].includes(element.type) ? Boolean(element.checked) : null,
          x: Math.round(offsetX + rect.x),
          y: Math.round(offsetY + rect.y),
          centerX: Math.round(offsetX + rect.x + rect.width / 2),
          centerY: Math.round(offsetY + rect.y + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
      for (const host of Array.from(root.querySelectorAll('*'))) {
        if (elements.length > limit) break;
        if (host.shadowRoot) {
          const selector = selectorFor(host);
          visit(host.shadowRoot, [...boundaries, { kind: 'shadow', label: selector + '::shadow' }], offsetX, offsetY);
        }
      }
      for (const frame of Array.from(root.querySelectorAll('iframe'))) {
        if (elements.length > limit) break;
        try {
          const frameDocument = frame.contentDocument;
          if (!frameDocument) continue;
          const rect = frame.getBoundingClientRect();
          const selector = selectorFor(frame);
          visit(
            frameDocument,
            [...boundaries, { kind: 'frame', label: selector + '::frame' }],
            offsetX + rect.x,
            offsetY + rect.y
          );
        } catch {
          // Cross-origin frames remain visible as iframe elements but are not inspected.
        }
      }
    };
    visit(document, [], 0, 0);
    return {
      text: textParts.join('\n').slice(0, 100000),
      elements: elements.slice(0, limit),
      truncated: elements.length > limit
    };
  })()`;
}

function browserWaitScript(condition: "selector" | "text", expected: string): string {
  return `(() => {
    const condition = ${JSON.stringify(condition)};
    const expected = ${JSON.stringify(expected)};
    const roots = [];
    const visit = (root) => {
      if (!root || roots.includes(root)) return;
      roots.push(root);
      for (const element of Array.from(root.querySelectorAll('*'))) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
      for (const frame of Array.from(root.querySelectorAll('iframe'))) {
        try { if (frame.contentDocument) visit(frame.contentDocument); } catch {}
      }
    };
    visit(document);
    if (condition === 'selector') return roots.some((root) => Boolean(root.querySelector(expected)));
    return roots.some((root) => {
      const text = root.nodeType === 9 ? root.body?.innerText : root.textContent;
      return String(text || '').includes(expected);
    });
  })()`;
}

function agentScreenshotDataUrl(image: Electron.NativeImage): string {
  const originalWidth = image.getSize().width;
  const widths = [960, 768, 640, 512, 420];
  const qualities = [65, 55, 45, 35, 30];
  let encoded = image.toJPEG(qualities[0]);
  for (let index = 0; index < widths.length; index += 1) {
    const width = Math.min(originalWidth, widths[index]);
    const resized = width < originalWidth ? image.resize({ width, quality: "good" }) : image;
    encoded = resized.toJPEG(qualities[index]);
    if (encoded.byteLength <= 100_000) break;
  }
  return `data:image/jpeg;base64,${encoded.toString("base64")}`;
}

function cloneRetryDescriptor(
  descriptor: ManagedBrowserRetryDescriptor
): ManagedBrowserRetryDescriptor {
  if (descriptor.kind === "upload") {
    return { ...descriptor, relativePaths: [...descriptor.relativePaths] };
  }
  if (descriptor.kind === "press") {
    return { ...descriptor, modifiers: [...descriptor.modifiers] };
  }
  return { ...descriptor };
}
