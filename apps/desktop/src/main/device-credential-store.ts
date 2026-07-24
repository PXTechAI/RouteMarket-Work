import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";

export type DeviceAccount = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl?: string | null;
  creditsBalance?: number;
  spaces?: DeviceSpace[];
  activeSpaceId?: string;
  membership?: {
    planCode: string;
    planName: string;
    status: string;
    expiresAt: string;
  } | null;
};

export type DeviceSpace = {
  id: string;
  name: string;
  kind: "personal" | "team";
  teamId: string | null;
  avatarUrl: string | null;
  role: string | null;
};

export type DeviceCredentials = {
  accessToken: string;
  expiresAt: string;
  scopes: string[];
  account: DeviceAccount;
};

export type PendingDesktopAuthorization = {
  state: string;
  codeVerifier: string;
  createdAt: string;
};

export type DeviceCredentialPayload = {
  credentials?: DeviceCredentials;
  pendingAuthorization?: PendingDesktopAuthorization;
};

type EncryptedCredentialFile = {
  version: 1;
  encrypted: string;
};

export class DeviceCredentialStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<DeviceCredentialPayload> {
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw) return {};
    this.requireEncryption();

    const envelope = JSON.parse(raw) as Partial<EncryptedCredentialFile>;
    if (envelope.version !== 1 || typeof envelope.encrypted !== "string") {
      throw new Error("Stored RouteMarket credentials are invalid.");
    }
    const decrypted = safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"));
    return JSON.parse(decrypted) as DeviceCredentialPayload;
  }

  async write(payload: DeviceCredentialPayload): Promise<void> {
    this.requireEncryption();
    await mkdir(dirname(this.filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(payload)).toString("base64");
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify({ version: 1, encrypted } satisfies EncryptedCredentialFile),
      { encoding: "utf8", mode: 0o600 }
    );
    await rename(temporaryPath, this.filePath);
  }

  async clear(): Promise<void> {
    await unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  private requireEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this device.");
    }
  }
}
