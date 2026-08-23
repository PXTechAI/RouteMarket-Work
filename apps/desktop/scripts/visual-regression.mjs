import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { createServer as createViteServer } from "vite";
import { WebSocket } from "ws";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..");
const baselineDirectory = join(desktopDirectory, "tests", "visual-baselines");
const updateBaselines = process.argv.includes("--update");
const viewport = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const scenarios = [
  { name: "workspace", selector: ".app-shell" },
  { name: "usage", selector: ".rm-desktop-usage" },
  { name: "account-menu", selector: ".rm-account-menu" },
];

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      socket.once("open", resolvePromise);
      socket.once("error", reject);
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.on("message", (rawMessage) => {
      const message = JSON.parse(rawMessage.toString());
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

let viteServer;
let browserProcess;
let cdp;
let temporaryProfile;

try {
  const browserExecutable = await findBrowserExecutable();
  const debuggingPort = await reservePort();
  temporaryProfile = await mkdtemp(join(tmpdir(), "routemarket-visual-"));
  viteServer = await createViteServer({
    configFile: join(desktopDirectory, "vite.renderer.config.ts"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await viteServer.listen();
  const previewUrl = viteServer.resolvedUrls?.local[0];
  if (!previewUrl) throw new Error("Vite did not expose a local preview URL.");

  browserProcess = spawn(
    browserExecutable,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-features=Translate",
      "--disable-sync",
      "--force-color-profile=srgb",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--no-first-run",
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${temporaryProfile}`,
      `--window-size=${viewport.width},${viewport.height}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  const target = await waitForPageTarget(debuggingPort);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", viewport);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.setItem("routemarket-work.theme", "light");
      localStorage.setItem("routemarket.work.locale", "zh-CN");
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{animation:none!important;caret-color:transparent!important;transition:none!important}";
      document.documentElement.append(style);
    `,
  });
  await cdp.send("Page.navigate", { url: previewUrl });
  await waitForSelector(".app-shell");
  await settleLayout();
  await captureScenario(scenarios[0]);

  await evaluate(`document.querySelector("nav.rm-rail > button.rm-rail-button")?.click()`);
  await waitForSelector(".rm-settings-page");
  await evaluate(`document.querySelector(".rm-settings-nav nav button:nth-child(4)")?.click()`);
  await waitForSelector(".rm-desktop-usage");
  await settleLayout();
  await captureScenario(scenarios[1]);

  await evaluate(`document.querySelector(".rm-rail-account")?.click()`);
  await waitForSelector(".rm-account-menu");
  await settleLayout();
  await captureScenario(scenarios[2]);

  process.stdout.write(
    updateBaselines
      ? `Updated ${scenarios.length} visual baselines in ${baselineDirectory}.\n`
      : `Visual regression passed (${scenarios.length} scenarios).\n`,
  );
} finally {
  if (cdp) {
    await cdp.send("Browser.close").catch(() => undefined);
    cdp.close();
  }
  if (browserProcess?.exitCode === null) {
    await Promise.race([
      once(browserProcess, "exit"),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
    ]);
  }
  if (browserProcess?.exitCode === null) {
    browserProcess.kill();
    await Promise.race([
      once(browserProcess, "exit"),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
    ]);
  }
  await viteServer?.close();
  if (temporaryProfile) {
    const expectedPrefix = join(tmpdir(), "routemarket-visual-");
    const resolvedProfile = resolve(temporaryProfile);
    if (
      resolvedProfile.startsWith(expectedPrefix) &&
      resolvedProfile.split(sep).length > resolve(tmpdir()).split(sep).length
    ) {
      await rm(resolvedProfile, { recursive: true, force: true });
    }
  }
}

async function captureScenario({ name, selector }) {
  const clip = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "start", inline: "start" });
    const rect = element.getBoundingClientRect();
    return {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.min(innerWidth - Math.max(0, rect.x), rect.width),
      height: Math.min(innerHeight - Math.max(0, rect.y), rect.height),
      scale: 1
    };
  })()`);
  if (!clip || clip.width < 1 || clip.height < 1) throw new Error(`Cannot capture ${name}: empty ${selector} bounds.`);
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  });
  const actual = Buffer.from(data, "base64");
  const baselinePath = join(baselineDirectory, `${name}.png`);
  if (updateBaselines) {
    await mkdir(baselineDirectory, { recursive: true });
    await writeFile(baselinePath, actual);
    return;
  }
  const expected = await readFile(baselinePath).catch(() => null);
  if (!expected) throw new Error(`Missing visual baseline ${baselinePath}. Run pnpm test:visual:update first.`);
  comparePng(name, expected, actual);
}

function comparePng(name, expectedBuffer, actualBuffer) {
  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `${name}: expected ${expected.width}x${expected.height}, received ${actual.width}x${actual.height}.`,
    );
  }
  let changedPixels = 0;
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    const difference = Math.max(
      Math.abs(expected.data[offset] - actual.data[offset]),
      Math.abs(expected.data[offset + 1] - actual.data[offset + 1]),
      Math.abs(expected.data[offset + 2] - actual.data[offset + 2]),
      Math.abs(expected.data[offset + 3] - actual.data[offset + 3]),
    );
    if (difference > 32) changedPixels += 1;
  }
  const changedPixelRatio = changedPixels / (expected.width * expected.height);
  if (changedPixelRatio > 0.015) {
    throw new Error(`${name}: ${(changedPixelRatio * 100).toFixed(2)}% of pixels changed; allowed 1.50%.`);
  }
}

async function settleLayout() {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  await evaluate(`document.fonts?.ready.then(() => true)`);
}

async function waitForSelector(selector, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${selector}.`);
}

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? `Evaluation failed: ${expression}`);
  return response.result.value;
}

async function findBrowserExecutable() {
  const candidates = [
    process.env.ROUTEMARKET_VISUAL_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported browser location.
    }
  }
  throw new Error("No Chromium browser found. Set ROUTEMARKET_VISUAL_BROWSER to an Edge or Chrome executable.");
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a browser debugging port.");
  await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
  return address.port;
}

async function waitForPageTarget(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Browser startup is still in progress.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the browser debugging target.");
}
