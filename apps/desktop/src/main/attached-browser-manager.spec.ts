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
        const result = message.method === "Runtime.evaluate"
          ? { result: { value: "Extracted fixture text" } }
          : message.method === "Page.captureScreenshot"
            ? { data: "cG5n" }
            : {};
        socket.send(JSON.stringify({ id: message.id, result }));
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
    await expect(manager.navigate("https://openai.com")).resolves.toMatchObject({
      target: { url: "https://openai.com/" }
    });
  });
});
