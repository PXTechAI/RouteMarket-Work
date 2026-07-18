import { randomUUID } from "node:crypto";
import {
  WebContentsView,
  type BrowserWindow,
  type Event,
  type Rectangle,
  type Session
} from "electron";
import type {
  ManagedBrowserPageSummary,
  ManagedBrowserProfile,
  ManagedBrowserProfileInput,
  ManagedBrowserState
} from "../shared/desktop-api";
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
};

export class ManagedBrowserManager {
  private readonly profiles = new Map<string, ManagedBrowserProfile>();
  private readonly pages = new Map<string, BrowserPageRecord>();
  private readonly activePageByProject = new Map<string, string>();
  private readonly configuredSessions = new Map<Session, (event: Event) => void>();
  private activeProjectId: string | null = null;
  private visible = false;
  private bounds: Rectangle = { x: 0, y: 0, width: 1, height: 1 };

  constructor(private readonly window: BrowserWindow) {}

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

  async navigate(localProjectId: string, value: string, pageId?: string): Promise<ManagedBrowserState> {
    const page = await this.resolvePage(localProjectId, pageId);
    page.crashed = false;
    await page.view.webContents.loadURL(normalizeBrowserUrl(value));
    return this.stateFor(page);
  }

  async back(localProjectId: string, pageId?: string): Promise<ManagedBrowserState> {
    const page = await this.resolvePage(localProjectId, pageId);
    if (page.view.webContents.canGoBack()) page.view.webContents.goBack();
    return this.stateFor(page);
  }

  async forward(localProjectId: string, pageId?: string): Promise<ManagedBrowserState> {
    const page = await this.resolvePage(localProjectId, pageId);
    if (page.view.webContents.canGoForward()) page.view.webContents.goForward();
    return this.stateFor(page);
  }

  async reload(localProjectId: string, pageId?: string): Promise<ManagedBrowserState> {
    const page = await this.resolvePage(localProjectId, pageId);
    page.view.webContents.reload();
    return this.stateFor(page);
  }

  async setUserTakeover(
    localProjectId: string,
    value: boolean,
    pageId?: string
  ): Promise<ManagedBrowserState> {
    const page = await this.resolvePage(localProjectId, pageId);
    page.userTakeover = value;
    await this.applyInteractionMode(page);
    return this.stateFor(page);
  }

  async click(localProjectId: string, selectorValue: string, pageId?: string): Promise<void> {
    const page = await this.resolvePage(localProjectId, pageId);
    const selector = assertSafeSelector(selectorValue);
    await page.view.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error("Browser element not found");
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
    })()`);
  }

  async type(
    localProjectId: string,
    selectorValue: string,
    textValue: string,
    pageId?: string
  ): Promise<void> {
    const page = await this.resolvePage(localProjectId, pageId);
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

  async extract(localProjectId: string, selectorValue: string, pageId?: string): Promise<string> {
    const page = await this.resolvePage(localProjectId, pageId);
    const selector = assertSafeSelector(selectorValue);
    return page.view.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Browser element not found");
      return (element.textContent || "").slice(0, 1000000);
    })()`);
  }

  async screenshot(localProjectId: string, pageId?: string): Promise<string> {
    const page = await this.resolvePage(localProjectId, pageId);
    return (await page.view.webContents.capturePage()).toDataURL();
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
    const view = new WebContentsView({
      webPreferences: {
        partition: browserPartition(profile),
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
      userTakeover: true
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
    const preventDownload = (event: Event) => event.preventDefault();
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.on("will-download", preventDownload);
    this.configuredSessions.set(session, preventDownload);
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
      pages: this.projectPages(page.localProjectId).map(browserPageSummary)
    };
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
