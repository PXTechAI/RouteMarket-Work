import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { AttachedBrowserManager } from "./attached-browser-manager";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

describe("AttachedBrowserManager", () => {
  it("discovers a localhost page and invokes CDP without exposing a remote endpoint", async () => {
    let port = 0;
    const server = createServer((request, response) => {
      if (request.url !== "/json/list") {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify([{
        id: "page_1",
        type: "page",
        title: "Fixture",
        url: "https://example.com/",
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/page_1`
      }]));
    });
    const sockets = new WebSocketServer({ server });
    sockets.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { id: number; method: string; params?: Record<string, unknown> };
        const expression = String(message.params?.expression ?? "");
        const runtimeValue = expression.includes("const locator =")
          ? {
              tag: expression.includes('const action = "type"') ? "input" : "button",
              role: "button",
              name: "Submit",
              inputType: expression.includes('const action = "type"') ? "text" : null,
              x: 120,
              y: 80
            }
          : expression.includes("const limit =")
            ? {
                text: "Fixture Submit",
                elements: [{
                  index: 0,
                  tag: "button",
                  role: "button",
                  name: "Submit",
                  text: "Submit",
                  selector: "#submit",
                  locator: "#shell::shadow >>> #submit",
                  context: "shadow",
                  inputType: null,
                  href: null,
                  disabled: false,
                  checked: null,
                  x: 70,
                  y: 64,
                  centerX: 120,
                  centerY: 80,
                  width: 100,
                  height: 32
                }],
                truncated: false
              }
            : "Extracted fixture text";
        const result = message.method === "Runtime.evaluate"
          ? { result: { value: runtimeValue } }
          : message.method === "Page.captureScreenshot"
            ? { data: "cG5n" }
            : message.method === "Network.getResponseBody"
              ? { body: "eyJvayI6dHJ1ZX0=", base64Encoded: true }
            : {};
        socket.send(JSON.stringify({ id: message.id, result }));
        if (message.method === "Network.enable") {
          socket.send(JSON.stringify({
            method: "Runtime.consoleAPICalled",
            params: {
              type: "error",
              args: [{ type: "string", value: "Fixture console error" }],
              stackTrace: { callFrames: [{ url: "https://example.com/app.js", lineNumber: 9 }] }
            }
          }));
          socket.send(JSON.stringify({
            method: "Network.requestWillBeSent",
            params: {
              requestId: "request_1",
              type: "Fetch",
              timestamp: 10,
              wallTime: 1_776_060_000,
              request: {
                method: "GET",
                url: "https://example.com/api?token=secret&q=visible",
                headers: { Authorization: "Bearer secret", Accept: "application/json" }
              }
            }
          }));
          socket.send(JSON.stringify({
            method: "Network.responseReceived",
            params: {
              requestId: "request_1",
              response: {
                status: 500,
                statusText: "Internal Server Error",
                mimeType: "application/json",
                headers: { "Content-Type": "application/json" }
              }
            }
          }));
          socket.send(JSON.stringify({
            method: "Network.loadingFinished",
            params: { requestId: "request_1", timestamp: 10.12 }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    cleanups.push(() => new Promise<void>((resolve) => sockets.close(() => resolve())));
    cleanups.push(() => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    ));
    const manager = new AttachedBrowserManager();
    cleanups.push(async () => { await manager.disconnect(); });
    const endpoint = `http://127.0.0.1:${port}`;

    await expect(manager.discover(endpoint)).resolves.toEqual([{
      targetId: "page_1",
      title: "Fixture",
      url: "https://example.com/",
      type: "page"
    }]);
    await expect(manager.connect(endpoint)).resolves.toMatchObject({
      connected: true,
      target: { targetId: "page_1" }
    });
    await expect(manager.extract("main")).resolves.toBe("Extracted fixture text");
    await expect(manager.screenshot()).resolves.toBe("data:image/png;base64,cG5n");
    await expect(manager.screenshot("agent")).resolves.toBe("data:image/jpeg;base64,cG5n");
    const inspected = await manager.inspect(50);
    expect(inspected).toMatchObject({
      pageId: "page_1",
      elements: [{
        refId: expect.stringMatching(/^element_[a-f0-9]{20}$/),
        locator: "#shell::shadow >>> #submit",
        context: "shadow"
      }]
    });
    const refId = inspected.elements[0]!.refId;
    await expect(manager.clickRef(refId)).resolves.toMatchObject({
      completed: true,
      refId,
      target: { tag: "button", x: 120, y: 80 }
    });
    await expect(manager.typeRef(refId, "private input")).resolves.toMatchObject({
      completed: true,
      refId,
      target: { tag: "input", inputType: "text" }
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(manager.getConsole()).toEqual([
      expect.objectContaining({ level: "error", message: "Fixture console error", line: 9 })
    ]);
    expect(manager.getNetwork()).toEqual([
      expect.objectContaining({
        requestId: "request_1",
        url: "https://example.com/api?token=%5Bredacted%5D&q=visible",
        status: 500,
        durationMs: 120,
        requestHeaders: { authorization: "[redacted]", accept: "application/json" }
      })
    ]);
    await expect(manager.getNetworkBody("request_1")).resolves.toMatchObject({
      body: '{"ok":true}',
      base64Encoded: false
    });
    await expect(manager.navigate("https://openai.com")).resolves.toMatchObject({
      target: { url: "https://openai.com/" }
    });
    await expect(manager.clickRef(refId)).rejects.toMatchObject({
      code: "BROWSER_ELEMENT_REFERENCE_STALE"
    });
  });
});
