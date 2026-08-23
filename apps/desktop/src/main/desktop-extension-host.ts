import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertPluginManifest, type PluginManifest } from "@routemarket/work-protocol";
import type { MarketplacePluginPackage } from "@routemarket/work-worker-core";
import type { LocalAssetService } from "./local-asset-service";
import type { PluginMediaCapabilityService } from "./plugin-media-capability-service";

const MANIFEST_PATH = ".routemarket-plugin/plugin.json";
const MAX_LOCAL_PLUGINS = 128;
const START_TIMEOUT_MS = 20_000;
const OUTPUT_LIMIT = 32_000;

export type DesktopExtensionSummary = {
  pluginId: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  source: "local" | "marketplace" | "bundled";
  permissions: string[];
  models: NonNullable<PluginManifest["resources"]>["models"];
  navigation: Array<{
    id: string;
    title: string;
    pageId: string;
    group: "creation" | "workspace" | "tools";
    icon?: "audio-lines" | "video" | "image" | "wand-sparkles" | "puzzle" | "box" | "cpu";
    order: number;
  }>;
  pages: Array<{ id: string; title: string }>;
  runtimeStatus: "stopped" | "starting" | "running" | "failed";
  runtimeError: string | null;
};

export type DesktopExtensionPage = {
  pluginId: string;
  pageId: string;
  title: string;
  url: string;
};

type ExtensionPackage = MarketplacePluginPackage & {
  source: DesktopExtensionSummary["source"];
};

type RunningRuntime = {
  child: ChildProcessWithoutNullStreams;
  port: number;
  token: string;
  assetSessionToken: string | null;
  mediaCapabilitySessionToken: string | null;
  status: DesktopExtensionSummary["runtimeStatus"];
  error: string | null;
  output: string;
  intentionalStop: boolean;
};

export class DesktopExtensionHost {
  private readonly extensions = new Map<string, ExtensionPackage>();
  private readonly runtimes = new Map<string, RunningRuntime>();
  private readonly runtimeStarts = new Map<string, Promise<RunningRuntime>>();

  constructor(
    private readonly localPluginRoot: string,
    private readonly dataRoot: string,
    private readonly developerMode = false,
    private readonly assetService?: LocalAssetService,
    private readonly mediaCapabilityService?: PluginMediaCapabilityService
  ) {}

  async refresh(marketplacePackages: MarketplacePluginPackage[] = []): Promise<DesktopExtensionSummary[]> {
    const localPackages = this.developerMode
      ? await discoverLocalExtensions(this.localPluginRoot)
      : [];
    const next = new Map<string, ExtensionPackage>();
    for (const item of marketplacePackages) {
      if (item.manifest.kind !== "desktop_extension" || item.manifest.status !== "available") continue;
      assertDesktopExtension(item.manifest);
      next.set(item.manifest.id, { ...item, source: item.manifest.distribution.source });
    }
    for (const item of localPackages) {
      if (next.has(item.manifest.id)) {
        throw new Error(`Local extension duplicates installed plugin ${item.manifest.id}.`);
      }
      next.set(item.manifest.id, item);
    }
    for (const pluginId of this.extensions.keys()) {
      const previous = this.extensions.get(pluginId);
      const replacement = next.get(pluginId);
      if (!replacement || previous?.rootPath !== replacement.rootPath || previous.manifest.version !== replacement.manifest.version) {
        await this.stop(pluginId);
      }
    }
    this.extensions.clear();
    for (const [pluginId, item] of next) this.extensions.set(pluginId, item);
    return this.list();
  }

  list(): DesktopExtensionSummary[] {
    return [...this.extensions.values()]
      .map((item) => summarize(item, this.runtimes.get(item.manifest.id)))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  assertPermission(pluginId: string, permission: PluginManifest["permissions"][number]): DesktopExtensionSummary {
    const extension = this.extensions.get(pluginId);
    if (!extension) throw new Error("Desktop extension is not available.");
    if (!extension.manifest.permissions.includes(permission)) {
      throw new Error(`Desktop extension ${pluginId} has not declared ${permission}.`);
    }
    return summarize(extension, this.runtimes.get(pluginId));
  }

  async openPage(pluginId: string, pageId: string): Promise<DesktopExtensionPage> {
    const extension = this.extensions.get(pluginId);
    if (!extension) throw new Error("Desktop extension is not available.");
    const page = extension.manifest.contributes.pages?.find((item) => item.id === pageId);
    if (!page) throw new Error("Desktop extension page is not available.");
    const runtime = await this.ensureRuntime(extension);
    const url = new URL(page.path, `http://127.0.0.1:${runtime.port}`);
    url.hash = `routemarketToken=${encodeURIComponent(runtime.token)}`;
    return { pluginId, pageId, title: page.title, url: url.toString() };
  }

  async stop(pluginId: string): Promise<void> {
    const starting = this.runtimeStarts.get(pluginId);
    if (starting) await starting.catch(() => undefined);
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) return;
    this.runtimes.delete(pluginId);
    if (runtime.assetSessionToken) this.assetService?.revokePluginSession(runtime.assetSessionToken);
    if (runtime.mediaCapabilitySessionToken) {
      this.mediaCapabilityService?.revokePluginSession(runtime.mediaCapabilitySessionToken);
    }
    runtime.intentionalStop = true;
    if (!runtime.child.killed) runtime.child.kill();
  }

  async close(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((pluginId) => this.stop(pluginId)));
    this.extensions.clear();
  }

  private async ensureRuntime(extension: ExtensionPackage): Promise<RunningRuntime> {
    const existing = this.runtimes.get(extension.manifest.id);
    if (existing?.status === "running") return existing;
    if (existing?.status === "starting") return waitUntilRunning(existing);
    if (existing) await this.stop(extension.manifest.id);

    const pending = this.runtimeStarts.get(extension.manifest.id);
    if (pending) return pending;
    const start = this.startRuntime(extension);
    this.runtimeStarts.set(extension.manifest.id, start);
    try {
      return await start;
    } finally {
      if (this.runtimeStarts.get(extension.manifest.id) === start) {
        this.runtimeStarts.delete(extension.manifest.id);
      }
    }
  }

  private async startRuntime(extension: ExtensionPackage): Promise<RunningRuntime> {

    const manifestRuntime = extension.manifest.runtime;
    if (!manifestRuntime) throw new Error("Desktop extension does not declare a local runtime.");
    const pluginRoot = await verifiedDirectory(extension.rootPath);
    const port = await availableLoopbackPort();
    const token = randomBytes(32).toString("base64url");
    const pluginDataRoot = resolve(this.dataRoot, extension.manifest.id);
    assertInside(this.dataRoot, pluginDataRoot);
    await mkdir(pluginDataRoot, { recursive: true, mode: 0o700 });

    const command = await resolveRuntimeCommand(pluginRoot, manifestRuntime.command);
    const args = manifestRuntime.args.map((value) => value
      .replaceAll("${pluginRoot}", pluginRoot)
      .replaceAll("${dataRoot}", pluginDataRoot));
    const assetSession = this.assetService
      ? await this.assetService.createPluginSession(extension.manifest.id, extension.manifest.permissions)
      : null;
    const mediaCapabilitySession = this.mediaCapabilityService
      ? await this.mediaCapabilityService.createPluginSession(
          extension.manifest.id,
          extension.manifest.permissions,
          extension.manifest.resources?.models ?? []
        )
      : null;
    const child = spawn(command, args, {
      cwd: pluginRoot,
      env: {
        ...process.env,
        ROUTEMARKET_PLUGIN_ID: extension.manifest.id,
        ROUTEMARKET_PLUGIN_PORT: String(port),
        ROUTEMARKET_PLUGIN_TOKEN: token,
        ROUTEMARKET_PLUGIN_ROOT: pluginRoot,
        ROUTEMARKET_PLUGIN_DATA_DIR: pluginDataRoot,
        ROUTEMARKET_PLUGIN_GPU_ALLOWED: extension.manifest.permissions.includes("device.gpu") ? "1" : "0",
        ROUTEMARKET_ASSET_SERVICE_URL: assetSession?.baseUrl,
        ROUTEMARKET_ASSET_SERVICE_TOKEN: assetSession?.token,
        ROUTEMARKET_MEDIA_GATEWAY_URL: mediaCapabilitySession?.baseUrl,
        ROUTEMARKET_MEDIA_GATEWAY_TOKEN: mediaCapabilitySession?.token
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });
    const runtime: RunningRuntime = {
      child,
      port,
      token,
      assetSessionToken: assetSession?.token ?? null,
      mediaCapabilitySessionToken: mediaCapabilitySession?.token ?? null,
      status: "starting",
      error: null,
      output: "",
      intentionalStop: false
    };
    this.runtimes.set(extension.manifest.id, runtime);
    const collect = (chunk: Buffer) => {
      runtime.output = `${runtime.output}${chunk.toString("utf8")}`.slice(-OUTPUT_LIMIT);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      runtime.status = "failed";
      runtime.error = error.message;
    });
    child.once("exit", (code, signal) => {
      if (runtime.assetSessionToken) this.assetService?.revokePluginSession(runtime.assetSessionToken);
      if (runtime.mediaCapabilitySessionToken) {
        this.mediaCapabilityService?.revokePluginSession(runtime.mediaCapabilitySessionToken);
      }
      if (runtime.intentionalStop) {
        runtime.status = "stopped";
        runtime.error = null;
        return;
      }
      if (runtime.status !== "failed") {
        runtime.status = "failed";
        runtime.error = `Runtime exited (${signal ?? code ?? "unknown"}).${runtime.output ? `\n${runtime.output}` : ""}`;
      }
      console.error(`[desktop-extension] ${extension.manifest.id} ${runtime.error}`);
    });

    try {
      await waitForHealth(port, token, manifestRuntime.transport.healthPath, runtime);
      runtime.status = "running";
      return runtime;
    } catch (error) {
      runtime.status = "failed";
      runtime.error = error instanceof Error ? error.message : String(error);
      if (runtime.assetSessionToken) this.assetService?.revokePluginSession(runtime.assetSessionToken);
      if (runtime.mediaCapabilitySessionToken) {
        this.mediaCapabilityService?.revokePluginSession(runtime.mediaCapabilitySessionToken);
      }
      if (!child.killed) child.kill();
      throw error;
    }
  }
}

async function discoverLocalExtensions(root: string): Promise<ExtensionPackage[]> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(root);
  const entries = (await readdir(canonicalRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .slice(0, MAX_LOCAL_PLUGINS);
  const result: ExtensionPackage[] = [];
  for (const entry of entries) {
    const rootPath = resolve(canonicalRoot, entry.name);
    assertInside(canonicalRoot, rootPath);
    const manifestPath = resolve(rootPath, MANIFEST_PATH);
    let value: unknown;
    try {
      const stat = await lstat(manifestPath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      value = JSON.parse(await readFile(manifestPath, "utf8"));
      assertPluginManifest(value);
      assertDesktopExtension(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Invalid local desktop extension at ${rootPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (value.distribution.source !== "local") {
      throw new Error(`Local desktop extension ${value.id} must use distribution.source=local.`);
    }
    result.push({ manifest: value, rootPath, source: "local" });
  }
  return result;
}

function assertDesktopExtension(manifest: PluginManifest): void {
  if (
    manifest.schemaVersion !== 2 ||
    manifest.kind !== "desktop_extension" ||
    manifest.distribution.packageFormat !== "desktop-extension" ||
    !manifest.permissions.includes("process") ||
    !manifest.runtime
  ) {
    throw new Error("Desktop extensions require schema v2, desktop-extension packaging, process permission and a runtime.");
  }
  const pages = new Set((manifest.contributes.pages ?? []).map((page) => page.id));
  if (!pages.size) throw new Error("Desktop extension must contribute at least one page.");
  for (const item of manifest.contributes.navigation ?? []) {
    if (!pages.has(item.pageId)) throw new Error(`Navigation ${item.id} references missing page ${item.pageId}.`);
  }
  if ((manifest.resources?.models ?? []).some((model) => model.recommendedVramMb) && !manifest.permissions.includes("device.gpu")) {
    throw new Error("GPU model resources require the device.gpu permission.");
  }
}

function summarize(item: ExtensionPackage, runtime?: RunningRuntime): DesktopExtensionSummary {
  const manifest = item.manifest;
  return {
    pluginId: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    publisher: manifest.publisher,
    source: item.source,
    permissions: [...manifest.permissions],
    models: structuredClone(manifest.resources?.models ?? []),
    navigation: (manifest.contributes.navigation ?? []).map((entry) => ({
      ...entry,
      order: entry.order ?? 0
    })),
    pages: (manifest.contributes.pages ?? []).map(({ id, title }) => ({ id, title })),
    runtimeStatus: runtime?.status ?? "stopped",
    runtimeError: runtime?.error ?? null
  };
}

async function resolveRuntimeCommand(pluginRoot: string, command: string): Promise<string> {
  if (!command.includes("/") && !command.includes("\\")) return command;
  const candidate = isAbsolute(command) ? resolve(command) : resolve(pluginRoot, command);
  assertInside(pluginRoot, candidate);
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Extension runtime command is not a safe file.");
  return candidate;
}

async function verifiedDirectory(path: string): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Extension root is not a safe directory.");
  return realpath(path);
}

function assertInside(root: string, candidate: string): void {
  const fromRoot = relative(resolve(root), resolve(candidate));
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Extension path escaped its allowed root.");
  }
}

async function availableLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForHealth(
  port: number,
  token: string,
  healthPath: string,
  runtime: RunningRuntime
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = "runtime did not answer";
  while (Date.now() < deadline) {
    if (runtime.status === "failed") throw new Error(runtime.error ?? "Extension runtime failed to start.");
    try {
      const response = await fetch(new URL(healthPath, `http://127.0.0.1:${port}`), {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1_000)
      });
      if (response.ok) return;
      lastError = `health check returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Extension runtime startup timed out: ${lastError}${runtime.output ? `\n${runtime.output}` : ""}`);
}

async function waitUntilRunning(runtime: RunningRuntime): Promise<RunningRuntime> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (runtime.status === "running") return runtime;
    if (runtime.status === "failed") throw new Error(runtime.error ?? "Extension runtime failed to start.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Extension runtime startup timed out.");
}
