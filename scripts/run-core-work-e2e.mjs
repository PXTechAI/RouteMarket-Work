import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const workRoot = resolve(import.meta.dirname, "..");
const corepackEntry = resolve(
  dirname(process.execPath),
  "node_modules",
  "corepack",
  "dist",
  "corepack.js"
);
const coreRoot = resolve(
  process.env.ROUTEMARKET_CORE_DIR || resolve(workRoot, "..", "..", "RouteMarket-Core")
);

if (!existsSync(corepackEntry)) {
  console.error(`Corepack was not found at ${corepackEntry}.`);
  process.exit(1);
}

if (!existsSync(resolve(coreRoot, "apps", "core-api", "package.json"))) {
  console.error(`RouteMarket Core was not found at ${coreRoot}.`);
  console.error("Set ROUTEMARKET_CORE_DIR to the Core repository root.");
  process.exit(1);
}

const build = spawnSync(
  process.execPath,
  [corepackEntry, "pnpm", "--dir", coreRoot, "--filter", "@route-lab/core-api", "build"],
  {
    cwd: coreRoot,
    env: process.env,
    stdio: "inherit"
  }
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const test = spawnSync(
  process.execPath,
  [
    corepackEntry,
    "pnpm",
    "--filter",
    "@routemarket/work-desktop",
    "exec",
    "vitest",
    "run",
    "src/main/cloud-worker-real-core.e2e.spec.ts"
  ],
  {
    cwd: workRoot,
    env: {
      ...process.env,
      ROUTEMARKET_CORE_DIR: coreRoot,
      ROUTEMARKET_CORE_E2E: "1",
      ROUTEMARKET_CORE_E2E_PORT: process.env.ROUTEMARKET_CORE_E2E_PORT || "43101"
    },
    stdio: "inherit"
  }
);

process.exit(test.status ?? 1);
