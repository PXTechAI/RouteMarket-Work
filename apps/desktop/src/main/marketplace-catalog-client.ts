import type {
  MarketplaceCatalogItem,
  MarketplaceCatalogResponse,
  MarketplaceResourceKind
} from "../shared/desktop-api";
import type { RouteMarketApiClient } from "./routemarket-api-client";

const RESOURCE_KINDS = new Set<MarketplaceResourceKind>([
  "plugin",
  "skill",
  "workflow",
  "app"
]);
const STATUSES = new Set(["available", "preview", "disabled"] as const);
const ACQUISITION_MODES = new Set(["install", "copy", "launch"] as const);
const MAX_PLUGIN_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 3;

export class MarketplaceCatalogClient {
  constructor(
    private readonly apiClient: RouteMarketApiClient,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async list(): Promise<MarketplaceCatalogResponse> {
    const response = await this.apiClient.request("/api/app/v1/marketplace/catalog");
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readResponseError(payload, response.status));
    }
    return parseMarketplaceCatalog(payload);
  }

  async downloadPluginPackage(item: MarketplaceCatalogItem): Promise<Buffer> {
    if (item.kind !== "plugin" || item.release.distributionSource !== "marketplace") {
      throw new Error("Marketplace item is not a downloadable plugin package.");
    }
    let url = assertSafePackageUrl(item.release.packageUrl);
    for (let redirect = 0; redirect <= MAX_DOWNLOAD_REDIRECTS; redirect += 1) {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "application/zip, application/octet-stream" },
        signal: AbortSignal.timeout(30_000)
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirect === MAX_DOWNLOAD_REDIRECTS) throw new Error("Marketplace package redirected too many times.");
        const location = response.headers.get("location");
        if (!location) throw new Error("Marketplace package redirect is missing a destination.");
        url = assertSafePackageUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`Marketplace package download failed (${response.status}).`);
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_PLUGIN_PACKAGE_BYTES) {
        throw new Error("Marketplace package is larger than 32 MB.");
      }
      if (!response.body) throw new Error("Marketplace package response has no body.");
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_PLUGIN_PACKAGE_BYTES) {
            await reader.cancel();
            throw new Error("Marketplace package is larger than 32 MB.");
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      if (!totalBytes) throw new Error("Marketplace package download was empty.");
      return Buffer.concat(chunks, totalBytes);
    }
    throw new Error("Marketplace package download failed.");
  }
}

export function parseMarketplaceCatalog(value: unknown): MarketplaceCatalogResponse {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("RouteMarket returned an unsupported Marketplace catalog.");
  }
  if (typeof value.revision !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.revision)) {
    throw new Error("RouteMarket returned an invalid Marketplace catalog revision.");
  }
  if (!Array.isArray(value.items) || value.items.length > 500) {
    throw new Error("RouteMarket returned an invalid Marketplace catalog item list.");
  }

  return {
    schemaVersion: 1,
    revision: value.revision,
    items: value.items.map(parseCatalogItem)
  };
}

function parseCatalogItem(value: unknown): MarketplaceCatalogItem {
  if (!isRecord(value)) throw new Error("Marketplace catalog item is invalid.");
  const kind = readEnum(value.kind, RESOURCE_KINDS, "resource kind");
  const status = readEnum(value.status, STATUSES, "status");
  const acquisitionMode = readEnum(value.acquisitionMode, ACQUISITION_MODES, "acquisition mode");
  const id = readString(value.id, "id", /^[a-z0-9][a-z0-9.-]{2,127}$/);
  const slug = readString(value.slug, "slug", /^[a-z0-9][a-z0-9-]{1,79}$/);
  const publisher = readString(value.publisher, "publisher");
  const name = readString(value.name, "name");
  const description = readString(value.description, "description", undefined, true);
  const release = parseRelease(value.release);
  return { id, slug, kind, publisher, name, description, status, acquisitionMode, release };
}

function parseRelease(value: unknown): MarketplaceCatalogItem["release"] {
  if (!isRecord(value)) throw new Error("Marketplace catalog release is invalid.");
  const version = readString(value.version, "release version", /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/);
  const minimumHostVersion = readString(
    value.minimumHostVersion,
    "minimum host version",
    /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/
  );
  if (value.distributionSource === "bundled") {
    return { distributionSource: "bundled", version, minimumHostVersion };
  }
  if (value.distributionSource !== "marketplace") {
    throw new Error("Marketplace catalog distribution source is invalid.");
  }
  const packageUrl = readString(value.packageUrl, "package URL");
  const parsedPackageUrl = new URL(packageUrl);
  if (parsedPackageUrl.protocol !== "https:") {
    throw new Error("Marketplace package URL must use HTTPS.");
  }
  const integrity = readString(value.integrity, "package integrity", /^sha256:[a-f0-9]{64}$/);
  if (!isRecord(value.signature) || value.signature.algorithm !== "ed25519") {
    throw new Error("Marketplace package signature is invalid.");
  }
  return {
    distributionSource: "marketplace",
    version,
    minimumHostVersion,
    packageUrl,
    integrity,
    signature: {
      algorithm: "ed25519",
      keyId: readString(value.signature.keyId, "signature key id", /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/),
      value: readString(value.signature.value, "signature value", undefined, false, 32)
    }
  };
}

function readEnum<T extends string>(value: unknown, options: ReadonlySet<T>, label: string): T {
  if (typeof value !== "string" || !options.has(value as T)) {
    throw new Error(`Marketplace catalog ${label} is invalid.`);
  }
  return value as T;
}

function readString(
  value: unknown,
  label: string,
  pattern?: RegExp,
  allowEmpty = false,
  minimumLength = 1
): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    (!allowEmpty && value.trim().length < minimumLength) ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`Marketplace catalog ${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readResponseError(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  return `RouteMarket Marketplace request failed (${status}).`;
}

function assertSafePackageUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Marketplace package URL must be an HTTPS URL without credentials.");
  }
  const host = url.hostname.toLocaleLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" || host.endsWith(".localhost") || host === "::1" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^0\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    /^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f:]*$/i.test(host)
  ) {
    throw new Error("Marketplace package URL cannot target a local network address.");
  }
  return url.toString();
}
