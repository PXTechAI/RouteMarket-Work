import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEVELOPMENT_ENDPOINTS = [
  "http://127.0.0.1:3001",
  "http://localhost:3000"
];

export function assertProductionBundleEndpoints(source) {
  const leaked = DEVELOPMENT_ENDPOINTS.filter((endpoint) =>
    source.includes(endpoint)
  );
  if (leaked.length) {
    throw new Error(
      `Production main bundle contains development endpoints: ${leaked.join(", ")}`
    );
  }
  if (!source.includes("https://console.routemarket.ai")) {
    throw new Error(
      "Production main bundle does not contain the expected RouteMarket origin."
    );
  }
}

async function main() {
  const value = process.argv[2];
  if (!value) throw new Error("Provide the production main bundle path.");
  const bundlePath = isAbsolute(value) ? value : resolve(process.cwd(), value);
  assertProductionBundleEndpoints(await readFile(bundlePath, "utf8"));
  process.stdout.write(`${JSON.stringify({ ok: true, bundlePath })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
