import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  prepareUpdateMetadata,
  withStagingPercentage
} from "./prepare-update-metadata.mjs";

test("adds or replaces electron-updater rollout metadata", () => {
  assert.equal(
    withStagingPercentage("version: 1.0.0\n", 25),
    "version: 1.0.0\nstagingPercentage: 25\n"
  );
  assert.equal(
    withStagingPercentage(
      "version: 1.0.0\nstagingPercentage: 10\n",
      50
    ),
    "version: 1.0.0\nstagingPercentage: 50\n"
  );
});

test("writes beta metadata without leaving a stable-channel file", async () => {
  const root = await mkdtemp(join(tmpdir(), "rm-update-metadata-"));
  try {
    await writeFile(join(root, "latest.yml"), "version: 1.0.0\n");
    const outputPath = await prepareUpdateMetadata({
      artifactDirectory: root,
      channel: "beta",
      rolloutPercentage: 10
    });
    assert.equal(outputPath, join(root, "beta.yml"));
    assert.match(await readFile(outputPath, "utf8"), /stagingPercentage: 10/);
    await assert.rejects(readFile(join(root, "latest.yml"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
