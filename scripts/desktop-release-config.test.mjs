import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopPackage = JSON.parse(
  await readFile(
    new URL("../apps/desktop/package.json", import.meta.url),
    "utf8"
  )
);

test("packages signed-update metadata without deleting local data on uninstall", () => {
  assert.equal(desktopPackage.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(desktopPackage.build.nsis.differentialPackage, true);
  assert.deepEqual(desktopPackage.build.publish, [{
    provider: "generic",
    url: "${env.ROUTEMARKET_WORK_UPDATE_URL}",
    channel: "latest",
    useMultipleRangeRequest: false
  }]);
  assert.equal(
    desktopPackage.dependencies["electron-updater"],
    "6.6.2"
  );
});

test("release command enforces signing, source, metadata and manifest gates", () => {
  const command = desktopPackage.scripts["dist:win"];
  for (const required of [
    "check-release-environment.mjs",
    "write-release-manifest.mjs --check-source",
    "build:release",
    "verify-windows-signature.ps1",
    "prepare-update-metadata.mjs",
    "write-release-manifest.mjs --artifact-dir"
  ]) {
    assert.match(command, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
