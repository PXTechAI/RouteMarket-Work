import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkCapabilityManifest,
  checkDesktopJob,
  checkDesktopNodeRegistry,
  checkEnvelope
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

  it("accepts a project Skill invocation only as an R0 pure read", async () => {
    const envelope = await readExample("job-offer.read-readme.json") as {
      payload: Record<string, unknown>;
    };
    const skillJob = {
      ...envelope.payload,
      executorKey: "local.skill.invoke",
      input: {
        skillId: "review",
        task: "Review the current project changes."
      },
      requiredCapabilities: ["local.skill.invoke"],
      executionClass: "pure_read",
      approvalPolicy: { risk: "R0", mode: "project_grant" }
    };

    expect(checkDesktopJob(skillJob)).toEqual({ ok: true });
    expect(checkDesktopJob({
      ...skillJob,
      approvalPolicy: { risk: "R2", mode: "invocation" }
    }).ok).toBe(false);
    expect(checkDesktopJob({
      ...skillJob,
      input: { skillId: "review", task: "", unexpected: true }
    }).ok).toBe(false);
  });
});
