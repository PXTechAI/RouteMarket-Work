import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopJob } from "@routemarket/work-protocol";
import type { ProjectSkillPackageIdentity } from "@routemarket/work-worker-core";

const storage = vi.hoisted(() => ({
  available: true
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    encryptString: (value: string) =>
      Buffer.from(`test-envelope:${Buffer.from(value).toString("base64")}`),
    decryptString: (value: Buffer) => {
      const encoded = value.toString().replace(/^test-envelope:/, "");
      return Buffer.from(encoded, "base64").toString();
    }
  }
}));

import { DeviceSkillSigner } from "./device-skill-signer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  storage.available = true;
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("DeviceSkillSigner", () => {
  it("persists one encrypted Ed25519 identity and authorizes only the signed package snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-skill-signer-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "signer.json");
    const identity = packageIdentity();
    const signer = new DeviceSkillSigner(filePath);

    const first = await signer.signManifest([identity]);
    const second = await new DeviceSkillSigner(filePath).signManifest([identity]);

    expect(first.signingKeys).toHaveLength(1);
    expect(first.localSkills).toHaveLength(1);
    expect(second.signingKeys[0]?.keyId).toBe(first.signingKeys[0]?.keyId);
    expect(second.localSkills[0]?.signature).toBe(first.localSkills[0]?.signature);
    expect(await readFile(filePath, "utf8")).not.toContain("privateKeyDer");

    signer.assertAuthorizedJob(skillJob(first.localSkills[0]!));
    expect(() => signer.assertAuthorizedJob({
      ...skillJob(first.localSkills[0]!),
      input: {
        ...skillJob(first.localSkills[0]!).input,
        packageDigest: `sha256:${"b".repeat(64)}`
      }
    })).toThrow(/does not match/i);
  });

  it("fails closed when operating-system encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-skill-signer-"));
    temporaryDirectories.push(directory);
    storage.available = false;

    await expect(
      new DeviceSkillSigner(join(directory, "signer.json"))
        .signManifest([packageIdentity()])
    ).rejects.toThrow(/secure storage is unavailable/i);
  });

  it("clears previously authorized identities when no local Skills remain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "routemarket-skill-signer-"));
    temporaryDirectories.push(directory);
    const signer = new DeviceSkillSigner(join(directory, "signer.json"));
    const signed = await signer.signManifest([packageIdentity()]);
    const job = skillJob(signed.localSkills[0]!);

    expect(await signer.signManifest([])).toEqual({
      signingKeys: [],
      localSkills: []
    });
    expect(() => signer.assertAuthorizedJob(job)).toThrow(/does not match/i);
  });
});

function packageIdentity(): ProjectSkillPackageIdentity {
  return {
    skillId: "review",
    version: "1.0.0",
    packageDigest: `sha256:${"a".repeat(64)}`,
    projectBindingId: "binding_project_1",
    permissions: ["project.read"],
    operations: ["invoke"],
    relativePath: ".codex/skills/review/SKILL.md"
  };
}

function skillJob(
  identity: {
    skillId: string;
    version: string;
    packageDigest: string;
    signingKeyId: string;
  }
): Extract<DesktopJob, { executorKey: "local.skill.invoke" }> {
  return {
    jobId: "job_skill_1",
    workflowRunId: "workflow_1",
    workflowNodeRunId: "node_1",
    runtimeId: "runtime_1",
    projectBindingId: "binding_project_1",
    executorKey: "local.skill.invoke",
    executorVersion: 1,
    input: {
      skillId: identity.skillId,
      version: identity.version,
      packageDigest: identity.packageDigest,
      signingKeyId: identity.signingKeyId,
      operation: "invoke",
      task: "Review the current project."
    },
    requiredCapabilities: ["local.skill.invoke"],
    executionClass: "external_side_effect",
    approvalPolicy: { risk: "R3", mode: "invocation" },
    idempotencyKey: `sha256:${"c".repeat(64)}`,
    deadlineAt: "2099-01-01T00:00:00.000Z",
    maxInlineResultBytes: 65_536
  };
}
