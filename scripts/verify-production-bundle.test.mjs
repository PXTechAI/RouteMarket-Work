import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionBundleEndpoints
} from "./verify-production-bundle.mjs";

test("accepts a production bundle without development service addresses", () => {
  assert.doesNotThrow(() =>
    assertProductionBundleEndpoints(
      'const API="https://console.routemarket.ai"; const DEVTOOLS="http://127.0.0.1:9222";'
    )
  );
});

test("rejects bundled local Work API and login origins", () => {
  assert.throws(
    () => assertProductionBundleEndpoints(
      'const API="http://127.0.0.1:3001"; const WEB="http://localhost:3000";'
    ),
    /development endpoints/
  );
});
