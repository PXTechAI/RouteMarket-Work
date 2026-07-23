import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsDirectory, "..");
const desktopPackagePath = join(repositoryRoot, "apps", "desktop", "package.json");

export async function createArtifactRecord(artifactPath) {
  const absolutePath = resolve(artifactPath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new Error(`Release artifact is not a file: ${absolutePath}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
  return {
    fileName: basename(absolutePath),
    bytes: fileStat.size,
    sha256: hash.digest("hex")
  };
}

export function manifestPathForArtifact(artifactPath) {
  const absolutePath = resolve(artifactPath);
  const extensionIndex = absolutePath.lastIndexOf(".");
  const basePath = extensionIndex > absolutePath.lastIndexOf("\\") &&
    extensionIndex > absolutePath.lastIndexOf("/")
    ? absolutePath.slice(0, extensionIndex)
    : absolutePath;
  return `${basePath}.manifest.json`;
}

export function readSourceState(root = repositoryRoot) {
  const commit = runGit(["rev-parse", "HEAD"], root);
  const status = runGit(["status", "--porcelain", "--untracked-files=all"], root);
  return {
    commit,
    dirty: status.length > 0
  };
}

export function assertCleanSource(sourceState) {
  if (sourceState.dirty) {
    throw new Error(
      "Release candidates must be built from a clean Git worktree. Commit or stash source changes first."
    );
  }
}

export async function writeReleaseManifest({
  artifactPath,
  platform,
  arch,
  allowDirty = false,
  createdAt = new Date().toISOString()
}) {
  if (!platform || !arch) throw new Error("Both platform and arch are required.");
  const desktopPackage = JSON.parse(await readFile(desktopPackagePath, "utf8"));
  const source = readSourceState();
  if (!allowDirty) assertCleanSource(source);
  const artifact = await createArtifactRecord(artifactPath);
  const manifest = {
    schemaVersion: 1,
    productName: desktopPackage.build?.productName ?? desktopPackage.name,
    version: desktopPackage.version,
    channel: "release-candidate",
    platform,
    arch,
    createdAt,
    source,
    artifact
  };
  const outputPath = manifestPathForArtifact(artifactPath);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return { outputPath, manifest };
}

export async function resolveWindowsArtifact(artifactDirectory, arch) {
  const desktopPackage = JSON.parse(await readFile(desktopPackagePath, "utf8"));
  const productName = desktopPackage.build?.productName ?? desktopPackage.name;
  return resolve(
    artifactDirectory,
    `${productName}-Setup-${desktopPackage.version}-${arch}.exe`
  );
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    if (item === "--check-source" || item === "--allow-dirty") {
      flags.add(item);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
    values.set(item, value);
    index += 1;
  }
  return { values, flags };
}

async function main() {
  const { values, flags } = parseArguments(process.argv.slice(2));
  const source = readSourceState();
  if (flags.has("--check-source")) {
    assertCleanSource(source);
    process.stdout.write(`${JSON.stringify({ ok: true, source })}\n`);
    return;
  }

  const platform = values.get("--platform") ?? "win32";
  const arch = values.get("--arch") ?? "x64";
  const artifactValue = values.get("--artifact");
  const artifactDirectory = values.get("--artifact-dir");
  if (!artifactValue && !artifactDirectory) {
    throw new Error("Provide --artifact or --artifact-dir.");
  }
  const artifactPath = artifactValue
    ? (isAbsolute(artifactValue) ? artifactValue : resolve(process.cwd(), artifactValue))
    : await resolveWindowsArtifact(
        isAbsolute(artifactDirectory)
          ? artifactDirectory
          : resolve(process.cwd(), artifactDirectory),
        arch
      );
  const result = await writeReleaseManifest({
    artifactPath,
    platform,
    arch,
    allowDirty: flags.has("--allow-dirty")
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
