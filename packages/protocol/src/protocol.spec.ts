import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkCapabilityManifest,
  checkDesktopJob,
  checkDesktopNodeRegistry,
  checkEnvelope,
  checkPluginManifest
} from "./index";

async function readExample(name: string) {
  const url = new URL(`../examples/${name}`, import.meta.url);
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

describe("RouteMarket Work protocol fixtures", () => {
  it("accepts the Phase 0 capability manifest", async () => {
    expect(checkCapabilityManifest(await readExample("capability-manifest.windows.json"))).toEqual({
      ok: true
    });
  });

  it("accepts the README job offer envelope and payload", async () => {
    const envelope = await readExample("job-offer.read-readme.json");
    expect(checkEnvelope(envelope)).toEqual({ ok: true });
    expect(checkDesktopJob((envelope as { payload: unknown }).payload)).toEqual({ ok: true });
  });

  it("rejects absolute paths in desktop jobs", async () => {
    const envelope = await readExample("job-offer.read-readme.json") as {
      payload: { input: { uri: string } };
    };
    envelope.payload.input.uri = "C:\\Users\\someone\\secret.txt";
    expect(checkDesktopJob(envelope.payload).ok).toBe(false);
  });

  it("validates versioned Desktop Workflow node registries", () => {
    expect(checkDesktopNodeRegistry({
      revisionHash: `sha256:${"a".repeat(64)}`,
      generatedAt: "2026-07-18T00:00:00.000Z",
      definitions: [{
        executorKey: "local.fs.read",
        definitionVersion: 1,
        source: "desktop_builtin",
        executionTarget: "desktop",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        requiredCapabilities: ["local.fs.read"],
        portability: "portable",
        definitionHash: `sha256:${"b".repeat(64)}`,
        title: "Read file",
        description: "Read a project file",
        available: true,
        blockedReason: null
      }]
    })).toEqual({ ok: true });
  });

  it("accepts a browser Desktop Job only with its required risk and capability", async () => {
    const envelope = await readExample("job-offer.read-readme.json") as {
      payload: Record<string, unknown>;
    };
    const browserJob = {
      ...envelope.payload,
      executorKey: "local.browser.navigate",
      input: { url: "https://example.com" },
      requiredCapabilities: ["local.browser.navigate"],
      executionClass: "external_side_effect",
      approvalPolicy: { risk: "R1", mode: "invocation" }
    };
    expect(checkDesktopJob(browserJob)).toEqual({ ok: true });
    expect(checkDesktopJob({
      ...browserJob,
      approvalPolicy: { risk: "R0", mode: "project_grant" }
    }).ok).toBe(false);
  });

  it("accepts project-relative browser uploads only as R3 invocation jobs", async () => {
    const envelope = await readExample("job-offer.read-readme.json") as {
      payload: Record<string, unknown>;
    };
    const uploadJob = {
      ...envelope.payload,
      executorKey: "local.browser.upload",
      input: {
        selector: "input[type=file]",
        relativePaths: ["assets/report.pdf", "exports/data.csv"],
        pageId: "page_1"
      },
      requiredCapabilities: ["local.browser.upload"],
      executionClass: "external_side_effect",
      approvalPolicy: { risk: "R3", mode: "invocation" }
    };

    expect(checkDesktopJob(uploadJob)).toEqual({ ok: true });
    expect(checkDesktopJob({
      ...uploadJob,
      input: { selector: "input[type=file]", relativePaths: ["../secret.txt"] }
    }).ok).toBe(false);
    expect(checkDesktopJob({
      ...uploadJob,
      approvalPolicy: { risk: "R2", mode: "invocation" }
    }).ok).toBe(false);
  });

  it("accepts a native app open job only for a known connector", async () => {
    const envelope = await readExample("job-offer.read-readme.json") as { payload: Record<string, unknown> };
    const appJob = {
      ...envelope.payload,
      executorKey: "local.app.open",
      input: { connectorId: "excel", relativePath: "reports/summary.xlsx" },
      requiredCapabilities: ["local.app.open"],
      executionClass: "external_side_effect",
      approvalPolicy: { risk: "R2", mode: "invocation" }
    };
    expect(checkDesktopJob(appJob)).toEqual({ ok: true });
    expect(checkDesktopJob({ ...appJob, input: { connectorId: "unknown" } }).ok).toBe(false);
  });

  it("accepts a signed project Skill invocation only as an R3 one-time approval", async () => {
    const envelope = await readExample("job-offer.read-readme.json") as {
      payload: Record<string, unknown>;
    };
    const skillJob = {
      ...envelope.payload,
      executorKey: "local.skill.invoke",
      input: {
        skillId: "review",
        version: "1.0.0",
        packageDigest: `sha256:${"a".repeat(64)}`,
        signingKeyId: "device_key_123",
        operation: "invoke",
        task: "Review the current project changes."
      },
      requiredCapabilities: ["local.skill.invoke"],
      executionClass: "external_side_effect",
      approvalPolicy: { risk: "R3", mode: "invocation" }
    };

    expect(checkDesktopJob(skillJob)).toEqual({ ok: true });
    expect(checkDesktopJob({
      ...skillJob,
      approvalPolicy: { risk: "R0", mode: "project_grant" }
    }).ok).toBe(false);
    expect(checkDesktopJob({
      ...skillJob,
      input: { ...skillJob.input, task: "", unexpected: true }
    }).ok).toBe(false);
  });

  it("accepts declarative plugins without executable entry points", () => {
    expect(checkPluginManifest({
      schemaVersion: 1,
      id: "ai.routemarket.spreadsheet",
      name: "Spreadsheet",
      description: "Spreadsheet document capabilities.",
      version: "0.1.0",
      publisher: "PXTechAI",
      kind: "declarative_plugin",
      status: "planned",
      distribution: { source: "bundled", packageFormat: "declarative" },
      engines: { routemarketWork: "^0.2.0" },
      permissions: ["project.read", "project.write", "artifact.write"],
      activationEvents: ["onFile:.xlsx", "onTool:spreadsheet.inspect"],
      contributes: {
        viewers: [{
          id: "spreadsheet.viewer",
          title: "Spreadsheet Preview",
          status: "available",
          extensions: [".xlsx", ".csv"],
          mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
          mode: "readonly"
        }],
        tools: [{
          name: "spreadsheet.inspect",
          title: "Inspect spreadsheet",
          status: "planned",
          description: "Inspect workbook metadata.",
          capability: "local.spreadsheet.read",
          risk: "R0"
        }],
        workflowNodes: [],
        connectors: []
      }
    })).toEqual({ ok: true });
  });

  it("accepts schema v2 desktop extensions with navigation, pages and local GPU runtimes", () => {
    expect(checkPluginManifest({
      schemaVersion: 2,
      id: "ai.routemarket.talking-head",
      name: "Local Talking Head",
      description: "Local GPU avatar video studio.",
      version: "0.1.0",
      publisher: "PXTechAI",
      kind: "desktop_extension",
      status: "available",
      distribution: { source: "local", packageFormat: "desktop-extension" },
      engines: { routemarketWork: ">=0.2.0" },
      permissions: [
        "process", "device.gpu", "data.read", "media.read", "media.write", "models.manage",
        "models.invoke.local", "models.invoke.cloud", "media.upload.cloud", "biometric.face", "biometric.voice"
      ],
      activationEvents: ["onPage:talking-head.studio"],
      requiresCapabilities: [{
        id: "audio.speech.synthesize",
        version: "^1.0.0",
        execution: ["local", "cloud"]
      }, {
        id: "video.lip_sync",
        version: "^1.0.0",
        execution: ["local", "cloud"],
        optional: true
      }],
      runtime: {
        type: "local_process",
        command: "python",
        args: ["runtime/server.py"],
        transport: { type: "http", healthPath: "/health" }
      },
      resources: {
        models: [{
          id: "musetalk-1.5",
          title: "MuseTalk 1.5",
          kind: "lip_sync",
          required: true,
          recommendedVramMb: 8192,
          license: "MIT",
          capabilities: ["video.lip_sync"],
          supportsStreaming: false,
          commercialUse: "allowed"
        }]
      },
      contributes: {
        viewers: [], tools: [], workflowNodes: [], connectors: [],
        navigation: [{
          id: "talking-head.nav",
          title: "口播工作室",
          pageId: "talking-head.studio",
          group: "creation",
          icon: "audio-lines",
          order: 40
        }],
        pages: [{
          id: "talking-head.studio",
          title: "口播工作室",
          source: "runtime",
          path: "/studio"
        }]
      }
    })).toEqual({ ok: true });
  });

  it("rejects plugin executable entry points and undeclared permissions", () => {
    const base = {
      schemaVersion: 1,
      id: "ai.routemarket.unsafe",
      name: "Unsafe",
      description: "",
      version: "1.0.0",
      publisher: "PXTechAI",
      kind: "declarative_plugin",
      status: "disabled",
      distribution: { source: "bundled", packageFormat: "declarative" },
      engines: { routemarketWork: "^0.2.0" },
      permissions: ["root"],
      activationEvents: [],
      contributes: { viewers: [], tools: [], workflowNodes: [], connectors: [] },
      main: "index.js"
    };
    expect(checkPluginManifest(base).ok).toBe(false);
  });

  it("keeps package integrity and signatures out of the in-archive manifest", () => {
    const manifest = {
      schemaVersion: 1,
      id: "ai.example.marketplace-plugin",
      name: "Marketplace Plugin",
      description: "A signed declarative plugin.",
      version: "1.0.0",
      publisher: "Example",
      kind: "declarative_plugin",
      status: "available",
      engines: { routemarketWork: "^0.2.0" },
      permissions: ["project.read"],
      activationEvents: [],
      contributes: { viewers: [], tools: [], workflowNodes: [], connectors: [] }
    };

    expect(checkPluginManifest({
      ...manifest,
      distribution: { source: "marketplace", packageFormat: "declarative" }
    })).toEqual({ ok: true });

    expect(checkPluginManifest({
      ...manifest,
      distribution: {
        source: "marketplace",
        packageFormat: "declarative",
        integrity: `sha256:${"a".repeat(64)}`
      }
    }).ok).toBe(false);
  });
});
