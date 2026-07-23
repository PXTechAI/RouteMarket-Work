import assert from "node:assert/strict";
import test from "node:test";
import {
  releaseChannel,
  rollout,
  validateReleaseEnvironment
} from "./check-release-environment.mjs";

const valid = {
  ROUTEMARKET_WORK_UPDATE_URL: "https://downloads.example.com/work",
  CSC_LINK: "certificate.pfx",
  CSC_KEY_PASSWORD: "secret"
};

test("requires signing credentials and a remote HTTPS update feed", () => {
  assert.throws(
    () => validateReleaseEnvironment({}, "win32"),
    /ROUTEMARKET_WORK_UPDATE_URL.*CSC_LINK.*CSC_KEY_PASSWORD/
  );
  assert.throws(
    () => validateReleaseEnvironment({
      ...valid,
      ROUTEMARKET_WORK_UPDATE_URL: "http://localhost:8080"
    }),
    /remote HTTPS/
  );
});

test("accepts stable and beta rollout policies", () => {
  assert.deepEqual(validateReleaseEnvironment({
    ...valid,
    ROUTEMARKET_WORK_UPDATE_CHANNEL: "beta",
    ROUTEMARKET_WORK_ROLLOUT_PERCENT: "15"
  }, "win32"), {
    platform: "win32",
    updateUrl: "https://downloads.example.com/work",
    channel: "beta",
    rolloutPercentage: 15,
    signingConfigured: true
  });
  assert.equal(releaseChannel(undefined), "stable");
  assert.equal(rollout(undefined), 100);
  assert.throws(() => releaseChannel("nightly"), /stable or beta/);
  assert.throws(() => rollout("0"), /1 to 100/);
  assert.throws(() => rollout("10.5"), /1 to 100/);
});
