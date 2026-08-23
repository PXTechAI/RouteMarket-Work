import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopExtensionHost } from "./desktop-extension-host";
import { LocalAssetService } from "./local-asset-service";

const hosts: DesktopExtensionHost[] = [];
const assetServices: LocalAssetService[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(assetServices.splice(0).map((service) => service.close()));
});

describe("DesktopExtensionHost", () => {
  it("discovers a local extension and starts its isolated HTTP runtime on demand", async () => {
    const parent = await mkdtemp(join(tmpdir(), "routemarket-extension-"));
    const localRoot = join(parent, "plugins", "dev");
    const pluginRoot = join(localRoot, "ai.example.voice-studio");
    await mkdir(join(pluginRoot, ".routemarket-plugin"), { recursive: true });
    await mkdir(join(pluginRoot, "runtime"), { recursive: true });
    await writeFile(join(pluginRoot, ".routemarket-plugin", "plugin.json"), JSON.stringify(manifest()));
    await writeFile(join(pluginRoot, "runtime", "server.cjs"), `
      const http = require("node:http");
      const port = Number(process.env.ROUTEMARKET_PLUGIN_PORT);
      const token = process.env.ROUTEMARKET_PLUGIN_TOKEN;
      http.createServer((req, res) => {
        if (req.headers.authorization !== "Bearer " + token) { res.writeHead(401).end(); return; }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("ok");
      }).listen(port, "127.0.0.1");
    `);
    const host = new DesktopExtensionHost(localRoot, join(parent, "data"), true);
    hosts.push(host);
    const extensions = await host.refresh();
    expect(extensions[0]).toMatchObject({
      pluginId: "ai.example.voice-studio",
      source: "local",
      runtimeStatus: "stopped",
      navigation: [{ pageId: "studio", group: "creation" }]
    });
    expect(host.assertPermission("ai.example.voice-studio", "device.gpu").name).toBe("Voice Studio");
    expect(() => host.assertPermission("ai.example.voice-studio", "network")).toThrow("has not declared network");

    const [page, concurrentPage] = await Promise.all([
      host.openPage("ai.example.voice-studio", "studio"),
      host.openPage("ai.example.voice-studio", "studio")
    ]);
    expect(page.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/studio#routemarketToken=/);
    expect(concurrentPage.url).toBe(page.url);
    expect(host.list()[0]?.runtimeStatus).toBe("running");
  });

  it("rejects navigation that points at an undeclared page", async () => {
    const parent = await mkdtemp(join(tmpdir(), "routemarket-extension-invalid-"));
    const localRoot = join(parent, "plugins", "dev");
    const pluginRoot = join(localRoot, "ai.example.voice-studio");
    await mkdir(join(pluginRoot, ".routemarket-plugin"), { recursive: true });
    const value = manifest();
    value.contributes.navigation[0]!.pageId = "missing";
    await writeFile(join(pluginRoot, ".routemarket-plugin", "plugin.json"), JSON.stringify(value));
    const host = new DesktopExtensionHost(localRoot, join(parent, "data"), true);
    hosts.push(host);
    await expect(host.refresh()).rejects.toThrow("references missing page");
  });

  it("does not activate development directories unless developer mode is explicit", async () => {
    const parent = await mkdtemp(join(tmpdir(), "routemarket-extension-disabled-"));
    const localRoot = join(parent, "plugins", "dev");
    const pluginRoot = join(localRoot, "ai.example.voice-studio");
    await mkdir(join(pluginRoot, ".routemarket-plugin"), { recursive: true });
    await writeFile(join(pluginRoot, ".routemarket-plugin", "plugin.json"), JSON.stringify(manifest()));
    const host = new DesktopExtensionHost(localRoot, join(parent, "data"));
    hosts.push(host);
    await expect(host.refresh()).resolves.toEqual([]);

    await expect(host.refresh([{ manifest: manifest(), rootPath: pluginRoot }])).resolves.toEqual([
      expect.objectContaining({
        pluginId: "ai.example.voice-studio",
        source: "local",
        navigation: [expect.objectContaining({ title: "Voice Studio", pageId: "studio" })]
      })
    ]);
    await expect(host.refresh([])).resolves.toEqual([]);
  });

  it("gives permitted runtimes an isolated host asset session", async () => {
    const parent = await mkdtemp(join(tmpdir(), "routemarket-extension-assets-"));
    const localRoot = join(parent, "plugins", "dev");
    const pluginRoot = join(localRoot, "ai.example.voice-studio");
    await mkdir(join(pluginRoot, ".routemarket-plugin"), { recursive: true });
    await mkdir(join(pluginRoot, "runtime"), { recursive: true });
    await writeFile(join(pluginRoot, ".routemarket-plugin", "plugin.json"), JSON.stringify(manifest()));
    await writeFile(join(pluginRoot, "runtime", "server.cjs"), `
      const http = require("node:http");
      const port = Number(process.env.ROUTEMARKET_PLUGIN_PORT);
      const token = process.env.ROUTEMARKET_PLUGIN_TOKEN;
      http.createServer(async (req, res) => {
        if (req.headers.authorization !== "Bearer " + token) { res.writeHead(401).end(); return; }
        const assetResponse = await fetch(process.env.ROUTEMARKET_ASSET_SERVICE_URL + "/v1/assets", {
          headers: { authorization: "Bearer " + process.env.ROUTEMARKET_ASSET_SERVICE_TOKEN }
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: assetResponse.status, assets: await assetResponse.json() }));
      }).listen(port, "127.0.0.1");
    `);
    const assetService = new LocalAssetService(join(parent, "assets", "assets.db"));
    assetServices.push(assetService);
    const host = new DesktopExtensionHost(localRoot, join(parent, "data"), true, assetService);
    hosts.push(host);
    await host.refresh();

    const page = await host.openPage("ai.example.voice-studio", "studio");
    const url = new URL(page.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("routemarketToken");
    url.hash = "";
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    await expect(response.json()).resolves.toEqual({ status: 200, assets: [] });
  });
});

function manifest() {
  return {
    schemaVersion: 2 as const,
    id: "ai.example.voice-studio",
    name: "Voice Studio",
    description: "Local talking-head studio.",
    version: "0.1.0",
    publisher: "Example",
    kind: "desktop_extension" as const,
    status: "available" as const,
    distribution: { source: "local" as const, packageFormat: "desktop-extension" as const },
    engines: { routemarketWork: ">=0.2.0" },
    permissions: ["process", "device.gpu", "media.read", "media.write"] as Array<"process" | "device.gpu" | "media.read" | "media.write">,
    activationEvents: ["onPage:studio"],
    runtime: {
      type: "local_process" as const,
      command: process.platform === "win32" ? "node.exe" : "node",
      args: ["runtime/server.cjs"],
      transport: { type: "http" as const, healthPath: "/health" }
    },
    resources: { models: [] },
    contributes: {
      viewers: [], tools: [], workflowNodes: [], connectors: [],
      navigation: [{ id: "voice-studio", title: "Voice Studio", pageId: "studio", group: "creation" as const, icon: "audio-lines" as const, order: 40 }],
      pages: [{ id: "studio", title: "Voice Studio", source: "runtime" as const, path: "/studio" }]
    }
  };
}
