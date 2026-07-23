import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertCleanSource,
  createArtifactRecord,
  manifestPathForArtifact
} from "./write-release-manifest.mjs";

test("creates an exact artifact hash and adjacent manifest path", async () => {
  const root = await mkdtemp(join(tmpdir(), "routemarket-release-manifest-"));
  try {
    const artifactPath = join(root, "RouteMarket Work-Setup-0.2.0-x64.exe");
    await writeFile(artifactPath, "release fixture", "utf8");
    const artifact = await createArtifactRecord(artifactPath);

    assert.deepEqual(artifact, {
      fileName: "RouteMarket Work-Setup-0.2.0-x64.exe",
      bytes: 15,
      sha256: "1a6eb76913cce5c41fa798010e0168ed32052853509646b7adeb43798e123583"
    });
    assert.equal(
      manifestPathForArtifact(artifactPath),
      join(root, "RouteMarket Work-Setup-0.2.0-x64.manifest.json")
    );
    assert.equal(await readFile(artifactPath, "utf8"), "release fixture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects release candidates from a dirty source tree", () => {
  assert.throws(
    () => assertCleanSource({ commit: "abc123", dirty: true }),
    /clean Git worktree/
  );
  assert.doesNotThrow(() => assertCleanSource({ commit: "abc123", dirty: false }));
});
