import { readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  releaseChannel,
  rollout
} from "./check-release-environment.mjs";

export function withStagingPercentage(yaml, percentage) {
  const line = `stagingPercentage: ${percentage}`;
  if (/^stagingPercentage:[ \t]*\d+[ \t]*$/m.test(yaml)) {
    return `${yaml
      .replace(/^stagingPercentage:[ \t]*\d+[ \t]*$/m, line)
      .trimEnd()}\n`;
  }
  return `${yaml.trimEnd()}\n${line}\n`;
}

export async function prepareUpdateMetadata({
  artifactDirectory,
  channel,
  rolloutPercentage
}) {
  const directory = resolve(artifactDirectory);
  const latestPath = resolve(directory, "latest.yml");
  const outputPath = resolve(
    directory,
    channel === "beta" ? "beta.yml" : "latest.yml"
  );
  const yaml = await readFile(latestPath, "utf8").catch(() => {
    throw new Error(
      "latest.yml is missing. electron-builder must generate update metadata first."
    );
  });
  await writeFile(
    outputPath,
    withStagingPercentage(yaml, rolloutPercentage),
    "utf8"
  );
  if (channel === "beta" && outputPath !== latestPath) {
    await rm(latestPath, { force: true });
  }
  return outputPath;
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const artifactValue = argument(process.argv.slice(2), "--artifact-dir");
    if (!artifactValue) throw new Error("--artifact-dir is required.");
    const outputPath = await prepareUpdateMetadata({
      artifactDirectory: isAbsolute(artifactValue)
        ? artifactValue
        : resolve(process.cwd(), artifactValue),
      channel: releaseChannel(
        process.env.ROUTEMARKET_WORK_UPDATE_CHANNEL
      ),
      rolloutPercentage: rollout(
        process.env.ROUTEMARKET_WORK_ROLLOUT_PERCENT
      )
    });
    process.stdout.write(`${JSON.stringify({ outputPath })}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
