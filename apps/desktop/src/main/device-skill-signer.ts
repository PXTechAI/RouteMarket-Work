import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type DesktopJob,
  type LocalSkillIdentity
} from "@routemarket/work-protocol";
import type { ProjectSkillPackageIdentity } from "@routemarket/work-worker-core";
import { safeStorage } from "electron";

type SigningMaterial = {
  keyId: string;
  publicKey: string;
  privateKeyDer: string;
};

type EncryptedSigningFile = {
  version: 1;
  encrypted: string;
};

type LocalSkillJob = Extract<DesktopJob, { executorKey: "local.skill.invoke" }>;

export class DeviceSkillSigner {
  private material: SigningMaterial | null = null;
  private authorized = new Map<string, LocalSkillIdentity>();

  constructor(private readonly filePath: string) {}

  async signManifest(identities: ProjectSkillPackageIdentity[]) {
    if (identities.length === 0) {
      this.authorized.clear();
      return {
        signingKeys: [],
        localSkills: []
      };
    }
    const material = await this.loadOrCreate();
    const privateKey = createPrivateKey({
      key: Buffer.from(material.privateKeyDer, "base64"),
      format: "der",
      type: "pkcs8"
    });
    const localSkills = identities.map((identity): LocalSkillIdentity => ({
      skillId: identity.skillId,
      version: identity.version,
      packageDigest: identity.packageDigest,
      signingKeyId: material.keyId,
      signature: sign(
        null,
        Buffer.from(localSkillSigningPayload(identity)),
        privateKey
      ).toString("base64"),
      projectBindingId: identity.projectBindingId,
      permissions: identity.permissions,
      operations: identity.operations
    }));
    this.authorized = new Map(localSkills.map((identity) => [
      identityKey(identity.projectBindingId, identity.skillId),
      identity
    ]));
    return {
      signingKeys: [{
        keyId: material.keyId,
        algorithm: "ed25519" as const,
        publicKey: material.publicKey,
        trust: "device" as const
      }],
      localSkills
    };
  }

  assertAuthorizedJob(job: LocalSkillJob): LocalSkillIdentity {
    const identity = this.authorized.get(
      identityKey(job.projectBindingId, job.input.skillId)
    );
    if (
      !identity ||
      identity.version !== job.input.version ||
      identity.packageDigest !== job.input.packageDigest ||
      identity.signingKeyId !== job.input.signingKeyId ||
      !identity.operations.includes(job.input.operation)
    ) {
      throw Object.assign(
        new Error("The local Skill job does not match this device's latest signed capability snapshot."),
        { code: "PROJECT_SKILL_IDENTITY_UNAUTHORIZED" }
      );
    }
    return identity;
  }

  private async loadOrCreate(): Promise<SigningMaterial> {
    if (this.material) return this.material;
    this.requireEncryption();
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (raw) {
      const envelope = JSON.parse(raw) as Partial<EncryptedSigningFile>;
      if (envelope.version !== 1 || typeof envelope.encrypted !== "string") {
        throw new Error("Stored local Skill signing identity is invalid.");
      }
      const decrypted = safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"));
      const material = JSON.parse(decrypted) as SigningMaterial;
      if (
        !/^device_[a-f0-9]{24}$/.test(material.keyId) ||
        typeof material.publicKey !== "string" ||
        typeof material.privateKeyDer !== "string"
      ) {
        throw new Error("Stored local Skill signing identity is invalid.");
      }
      this.material = material;
      return material;
    }

    const pair = generateKeyPairSync("ed25519");
    const publicDer = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const publicKey = publicDer.subarray(-32).toString("base64");
    const material: SigningMaterial = {
      keyId: `device_${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`,
      publicKey,
      privateKeyDer: (pair.privateKey.export({
        format: "der",
        type: "pkcs8"
      }) as Buffer).toString("base64")
    };
    const encrypted = safeStorage.encryptString(JSON.stringify(material)).toString("base64");
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify({ version: 1, encrypted } satisfies EncryptedSigningFile),
      { encoding: "utf8", mode: 0o600 }
    );
    await rename(temporaryPath, this.filePath);
    this.material = material;
    return material;
  }

  private requireEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable for local Skill signing.");
    }
  }
}

export function localSkillSigningPayload(input: {
  skillId: string;
  version: string;
  packageDigest: string;
  projectBindingId: string | null;
  permissions: string[];
  operations: string[];
}): string {
  return JSON.stringify({
    skillId: input.skillId,
    version: input.version,
    packageDigest: input.packageDigest,
    projectBindingId: input.projectBindingId,
    permissions: [...input.permissions].sort(),
    operations: [...input.operations].sort()
  });
}

function identityKey(projectBindingId: string | null, skillId: string): string {
  return `${projectBindingId ?? "global"}:${skillId}`;
}
