import { pathToFileURL } from "node:url";

export function validateReleaseEnvironment(
  environment,
  platform = process.platform
) {
  const required = [
    "ROUTEMARKET_WORK_UPDATE_URL",
    "CSC_LINK",
    "CSC_KEY_PASSWORD"
  ];
  const missing = required.filter((name) => !environment[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Release environment is missing: ${missing.join(", ")}`
    );
  }
  const updateUrl = secureRemoteUrl(environment.ROUTEMARKET_WORK_UPDATE_URL);
  const channel = releaseChannel(
    environment.ROUTEMARKET_WORK_UPDATE_CHANNEL
  );
  const rolloutPercentage = rollout(
    environment.ROUTEMARKET_WORK_ROLLOUT_PERCENT
  );
  return {
    platform,
    updateUrl,
    channel,
    rolloutPercentage,
    signingConfigured: true
  };
}

export function secureRemoteUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new Error("ROUTEMARKET_WORK_UPDATE_URL must be a remote HTTPS URL.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function releaseChannel(value) {
  if (!value || value === "stable") return "stable";
  if (value === "beta") return "beta";
  throw new Error("Release update channel must be stable or beta.");
}

export function rollout(value) {
  if (!value) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(
      "ROUTEMARKET_WORK_ROLLOUT_PERCENT must be an integer from 1 to 100."
    );
  }
  return parsed;
}

function parseArguments(argv) {
  const platformIndex = argv.indexOf("--platform");
  return platformIndex >= 0 ? argv[platformIndex + 1] : process.platform;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = validateReleaseEnvironment(
      process.env,
      parseArguments(process.argv.slice(2))
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
