import { createHash } from "node:crypto";
import { opendir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { LocalSkillPermission } from "@routemarket/work-protocol";
import { WorkerError } from "./errors";
import { projectBindingIdFor } from "./project-binding";
import { loadProjectContext } from "./project-context";
import { ProjectRegistry } from "./project-registry";
import { resolveProjectFile } from "./project-uri";

const MAX_PACKAGE_FILES = 256;
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
const SEMVER = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;

export type ProjectSkillPackageIdentity = {
  skillId: string;
  version: string;
  packageDigest: string;
  projectBindingId: string;
  permissions: LocalSkillPermission[];
  operations: string[];
  relativePath: string;
};

export async function inspectProjectSkillPackage(
  registry: ProjectRegistry,
  localProjectId: string,
  skillId: string
): Promise<ProjectSkillPackageIdentity> {
  const project = registry.get(localProjectId);
  if (!project) {
    throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");
  }
  const context = await loadProjectContext(registry, localProjectId);
  const skill = context.skills.find((candidate) => candidate.id === skillId);
  if (!skill) {
    throw new WorkerError(
      "PROJECT_SKILL_NOT_AVAILABLE",
      "The project Skill is no longer available."
    );
  }
  const packageRelativePath = skill.relativePath.replace(/\/SKILL\.md$/i, "");
  const packageRoot = await resolveProjectFile(project, packageRelativePath);
  const files = await collectPackageFiles(packageRoot);
  const digest = createHash("sha256");
  let instructionText = "";
  for (const file of files) {
    const content = await readFile(file.absolutePath);
    digest.update(JSON.stringify([file.relativePath, content.byteLength]));
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
    if (file.relativePath.toLocaleLowerCase() === "skill.md") {
      instructionText = content.toString("utf8");
    }
  }
  const version = parseVersion(instructionText);
  return {
    skillId: skill.id,
    version,
    packageDigest: `sha256:${digest.digest("hex")}`,
    projectBindingId: projectBindingIdFor(localProjectId),
    permissions: ["project.read"],
    operations: ["invoke"],
    relativePath: skill.relativePath
  };
}

export async function assertProjectSkillPackageIdentity(
  registry: ProjectRegistry,
  localProjectId: string,
  expected: {
    skillId: string;
    version: string;
    packageDigest: string;
    operation: string;
  }
): Promise<ProjectSkillPackageIdentity> {
  const current = await inspectProjectSkillPackage(registry, localProjectId, expected.skillId);
  if (
    current.version !== expected.version ||
    current.packageDigest !== expected.packageDigest ||
    !current.operations.includes(expected.operation)
  ) {
    throw new WorkerError(
      "PROJECT_SKILL_IDENTITY_CHANGED",
      "The local Skill package changed after it was authorized. Refresh capabilities and approve the new package."
    );
  }
  return current;
}

async function collectPackageFiles(root: string): Promise<Array<{
  absolutePath: string;
  relativePath: string;
}>> {
  const rootPath = resolve(root);
  const files: Array<{ absolutePath: string; relativePath: string; size: number }> = [];
  const pending = [rootPath];
  let totalBytes = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (entry.isSymbolicLink()) {
        throw new WorkerError(
          "PROJECT_SKILL_PACKAGE_UNSAFE",
          "Local Skill packages cannot contain symbolic links."
        );
      }
      const absolutePath = resolve(directory, entry.name);
      const fromRoot = relative(rootPath, absolutePath);
      if (
        !fromRoot ||
        fromRoot === ".." ||
        fromRoot.startsWith(`..${sep}`)
      ) {
        throw new WorkerError(
          "PROJECT_SKILL_PACKAGE_UNSAFE",
          "Local Skill package path escaped its installation directory."
        );
      }
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = await readFile(absolutePath);
      totalBytes += content.byteLength;
      files.push({
        absolutePath,
        relativePath: fromRoot.split(sep).join("/"),
        size: content.byteLength
      });
      if (files.length > MAX_PACKAGE_FILES || totalBytes > MAX_PACKAGE_BYTES) {
        throw new WorkerError(
          "PROJECT_SKILL_PACKAGE_TOO_LARGE",
          "Local Skill package exceeds the file or size limit."
        );
      }
    }
  }
  if (!files.some((file) => file.relativePath.toLocaleLowerCase() === "skill.md")) {
    throw new WorkerError("PROJECT_SKILL_NOT_AVAILABLE", "Local Skill package has no SKILL.md.");
  }
  return files
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(({ absolutePath, relativePath }) => ({ absolutePath, relativePath }));
}

function parseVersion(instructions: string): string {
  const frontmatter = instructions.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const candidate = frontmatter?.[1]
    ?.match(/^version:\s*["']?(.+?)["']?\s*$/m)?.[1]
    ?.trim();
  return candidate && SEMVER.test(candidate) ? candidate : "1.0.0";
}
