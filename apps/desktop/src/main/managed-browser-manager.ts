import { trMain } from "./i18n";
import { randomUUID } from "node:crypto";
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
  ManagedBrowserDownload,
  ManagedBrowserOperationKind,
  ManagedBrowserOperationSource,
  ManagedBrowserPageSummary,
  ManagedBrowserProfile,
  ManagedBrowserProfileInput,
  ManagedBrowserState,
  ManagedBrowserUploadResult
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
  normalizeBrowserProfileInput
} from "./managed-browser-profile";
import {
  assertSafeBrowserText,
  assertSafeSelector,
  normalizeBrowserUrl
} from "./managed-browser-policy";

type BrowserPageRecord = {
  pageId: string;
  profileId: string;
  localProjectId: string;
  view: WebContentsView;
  loading: boolean;
  crashed: boolean;
  userTakeover: boolean;
  downloadDirectory: string | null;
};

type SessionDownloadListener = (
  event: Event,
  item: DownloadItem,
  webContents: WebContents
) => void;

type ManagedBrowserManagerOptions = {
  resolveProjectRoot?(localProjectId: string): Promise<string>;
  dataScopeId?: string;
  onPersistentPartition?(partition: string): void;
};

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
  | { kind: "type"; pageId?: string; selector: string; text: string }
  | { kind: "upload"; pageId?: string; selector: string; relativePaths: string[] }
  | { kind: "extract"; pageId?: string; selector: string }
  | { kind: "screenshot"; pageId?: string };

export class ManagedBrowserManager {
  private readonly profiles = new Map<string, ManagedBrowserProfile>();
  private readonly pages = new Map<string, BrowserPageRecord>();
  private readonly downloads = new Map<string, ManagedBrowserDownload>();
  private readonly operations = new ManagedBrowserOperationStore();
  private readonly operationRetries = new Map<string, ManagedBrowserRetryDescriptor>();
  private readonly activePageByProject = new Map<string, string>();
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

  async show(localProjectId: string, bounds: Rectangle): Promise<ManagedBrowserState> {
    this.bounds = sanitizeBounds(bounds);
    const page = await this.ensureActivePage(localProjectId);
    this.activeProjectId = localProjectId;
    this.visible = true;
    this.syncVisibility(page.pageId);
    return this.stateFor(page);
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
    if (this.activeProjectId === localProjectId && this.visible) this.syncVisibility(page.pageId);
    if (initialUrl !== "about:blank") await page.view.webContents.loadURL(normalizeBrowserUrl(initialUrl));
    return this.stateFor(page);
  }

  async selectPage(localProjectId: string, pageId: string): Promise<ManagedBrowserState> {
    const page = this.requirePage(localProjectId, pageId);
    this.activePageByProject.set(localProjectId, pageId);
    if (this.activeProjectId === localProjectId && this.visible) this.syncVisibility(pageId);
    return this.stateFor(page);
  }

  async closePage(localProjectId: string, pageId: string): Promise<ManagedBrowserState> {
    const page = this.requirePage(localProjectId, pageId);
    const siblings = this.projectPages(localProjectId).filter((candidate) => candidate.pageId !== pageId);
    let next = siblings[0];
    if (!next) {
      const profile = this.requireProfile(localProjectId, page.profileId);
      next = await this.buildPage(profile);
    }
    this.destroyPage(page);
    this.activePageByProject.set(localProjectId, next.pageId);
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
        await page.view.webContents.loadURL(normalizeBrowserUrl(value));
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

  async screenshot(
    localProjectId: string,
    pageId?: string,
    context?: ManagedBrowserOperationContext
  ): Promise<string> {
    return this.runOperation(
      localProjectId,
      { kind: "screenshot", pageId },
      context,
      async (page) => (await page.view.webContents.capturePage()).toDataURL()
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
    } else if (descriptor.kind === "type") {
      await this.type(
        localProjectId,
        descriptor.selector,
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
    const existing = this.projectProfiles(localProjectId)[0];
    if (existing) return existing;
    const profile: ManagedBrowserProfile = {
      profileId: "profile_default",
      localProjectId,
      ...DEFAULT_BROWSER_PROFILE_INPUT
    };
    this.profiles.set(profileKey(localProjectId, profile.profileId), profile);
    return profile;
  }

  private async ensureActivePage(localProjectId: string): Promise<BrowserPageRecord> {
    const activePageId = this.activePageByProject.get(localProjectId);
    if (activePageId) {
      const activePage = this.pages.get(activePageId);
      if (activePage) return activePage;
    }
    const existing = this.projectPages(localProjectId)[0];
    if (existing) {
      this.activePageByProject.set(localProjectId, existing.pageId);
      return existing;
    }
    const profile = this.ensureDefaultProfile(localProjectId);
    const page = await this.buildPage(profile);
    this.activePageByProject.set(localProjectId, page.pageId);
    return page;
  }

  private async resolvePage(localProjectId: string, pageId?: string): Promise<BrowserPageRecord> {
    return pageId ? this.requirePage(localProjectId, pageId) : this.ensureActivePage(localProjectId);
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
      downloadDirectory: await this.prepareDownloadDirectory(profile.localProjectId)
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
    });
    view.webContents.on("did-stop-loading", () => {
      page.loading = false;
      void this.applyInteractionMode(page);
    });
    view.webContents.on("render-process-gone", () => {
      page.loading = false;
      page.crashed = true;
    });
    await view.webContents.loadURL("about:blank");
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
    this.configuredSessions.set(session, handleDownload);
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

  private stateFor(page: BrowserPageRecord): ManagedBrowserState {
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
      profiles: this.projectProfiles(page.localProjectId),
      pages: this.projectPages(page.localProjectId).map(browserPageSummary),
      downloads: [...this.downloads.values()]
        .filter((download) => download.localProjectId === page.localProjectId)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
      operations: this.operations.list(page.localProjectId)
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
    type: trMain("ui.7b93ef577697"),
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
  if (descriptor.kind === "upload") {
    return trMain("ui.1f9b94ec2ee8", [descriptor.selector, descriptor.relativePaths.length]);
  }
  if (descriptor.kind === "back") return trMain("ui.b14f0fab768a");
  if (descriptor.kind === "forward") return trMain("ui.705ebd023a30");
  if (descriptor.kind === "reload") return trMain("ui.7ad6eb0c3a1b");
  return trMain("ui.b2e23403971b");
}

function cloneRetryDescriptor(
  descriptor: ManagedBrowserRetryDescriptor
): ManagedBrowserRetryDescriptor {
  return descriptor.kind === "upload"
    ? { ...descriptor, relativePaths: [...descriptor.relativePaths] }
    : { ...descriptor };
}
