import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const port = Number.parseInt(process.argv[2] ?? "9333", 10);
const outputPath = resolve(process.argv[3] ?? "release/desktop-smoke.png");
const expandRail = process.argv[4] === "expand";
const clickTitle = process.argv[5] ?? "";
const createProjectName = process.argv[6] ?? "";
const chatMessage = process.argv[7] ?? "";

let targets;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
      if (!response.ok) throw new Error(`DevTools target request failed: ${response.status}`);
      return response.json();
    });
    break;
  } catch (error) {
    if (attempt === 99) throw error;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}
const target = targets.find((candidate) => candidate.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("No Electron page target found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

function call(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCall, rejectCall) => {
    pending.set(id, { resolve: resolveCall, reject: rejectCall });
  });
}

await call("Page.enable");
await call("Runtime.enable");

for (let attempt = 0; attempt < 50; attempt += 1) {
  const ready = await call("Runtime.evaluate", {
    expression: "Boolean(document.querySelector('.app-shell'))",
    returnByValue: true
  });
  if (ready.result.value === true) break;
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}

if (expandRail) {
  await call("Runtime.evaluate", {
    expression: "document.querySelector('button[aria-label=\"展开侧栏\"]')?.click()"
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
}

if (clickTitle) {
  await call("Runtime.evaluate", {
    expression: `document.querySelector('[title="${clickTitle.replaceAll('"', '\\"')}"]')?.click()`
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
}

if (createProjectName) {
  await call("Runtime.evaluate", {
    expression: `(() => {
      const input = document.querySelector('.project-dialog input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(createProjectName)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  await call("Runtime.evaluate", {
    expression: "document.querySelector('.project-dialog .primary-button')?.click()"
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
}

if (chatMessage) {
  await call("Runtime.evaluate", {
    expression: `(() => {
      const input = document.querySelector('.composer textarea');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(chatMessage)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  await call("Runtime.evaluate", {
    expression: "document.querySelector('.composer .send-button')?.click()"
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 900));
}

const stateResult = await call("Runtime.evaluate", {
  expression: `(() => {
    const root = document.documentElement;
    const body = document.body;
    const shell = document.querySelector('.app-shell');
    const workspace = document.querySelector('.workspace');
    const styles = [...document.styleSheets].map((sheet) => sheet.href || 'inline');
    return {
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      viewport: { width: innerWidth, height: innerHeight },
      bodySize: { width: body.scrollWidth, height: body.scrollHeight },
      hasAppShell: Boolean(shell),
      hasWorkspace: Boolean(workspace),
      shellDisplay: shell ? getComputedStyle(shell).display : null,
      workspaceDisplay: workspace ? getComputedStyle(workspace).display : null,
      bodyBackground: getComputedStyle(body).backgroundColor,
      accent: getComputedStyle(root).getPropertyValue('--rm-accent').trim(),
      styles,
      containsLegacyStylesheet: styles.some((href) => href.includes('styles.css')),
      visibleTextLength: body.innerText.trim().length
    };
  })()`,
  returnByValue: true
});

const screenshot = await call("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
socket.close();

const state = stateResult.result.value;
const failures = [
  state.readyState !== "complete" && "document did not finish loading",
  !state.hasAppShell && "app shell is missing",
  !state.hasWorkspace && "workspace is missing",
  state.shellDisplay !== "grid" && `app shell display is ${state.shellDisplay}`,
  state.workspaceDisplay !== "grid" && `workspace display is ${state.workspaceDisplay}`,
  state.bodySize.width !== state.viewport.width && "page overflows horizontally",
  state.bodySize.height !== state.viewport.height && "page overflows vertically",
  state.containsLegacyStylesheet && "legacy styles.css is still loaded",
  !state.accent && "brand accent token is missing",
  state.visibleTextLength === 0 && "page has no visible content"
].filter(Boolean);

process.stdout.write(`${JSON.stringify({ ...state, screenshot: outputPath, failures })}\n`);
if (failures.length > 0) process.exitCode = 1;
