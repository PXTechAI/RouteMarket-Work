import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkCapabilityManifest,
  checkDesktopJob,
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
});
