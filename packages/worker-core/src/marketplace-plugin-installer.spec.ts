import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  MarketplacePluginInstaller,
  marketplacePluginArchiveDigest,
  marketplacePluginSignaturePayload,
  type MarketplacePluginRelease
} from "./marketplace-plugin-installer";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("MarketplacePluginInstaller", () => {
  it("verifies and atomically installs a signed declarative package", async () => {
    const fixture = await createFixture();
    await expect(fixture.installer.inspectArchive(fixture.archive, fixture.release))
      .resolves.toMatchObject({ id: "ai.example.tables", permissions: ["project.read"] });
    await expect(fixture.installer.list()).resolves.toEqual([]);
    const receipt = await fixture.installer.installArchive(fixture.archive, fixture.release);

    expect(receipt).toMatchObject({
      pluginId: "ai.example.tables",
      version: "1.2.3",
      source: "marketplace",
      signerKeyId: "example.release.2026-01",
      status: "ready"
    });
    await expect(fixture.installer.listEnabledManifests()).resolves.toEqual([
      expect.objectContaining({ id: "ai.example.tables" })
    ]);
    expect(await readFile(join(
      fixture.scopeRoot,
      "plugins",
      "packages",
      "ai.example.tables",
      "1.2.3",
      ".routemarket-plugin",
      "plugin.json"
    ), "utf8")).toContain('"ai.example.tables"');
    fixture.installer.close();
  }, 20_000);

  it("fails closed for tampering and untrusted publisher keys", async () => {
    const fixture = await createFixture();
    const tampered = Buffer.concat([fixture.archive, Buffer.from("tampered")]);
    await expect(fixture.installer.installArchive(tampered, fixture.release))
      .rejects.toThrow("checksum");

    const untrusted = new MarketplacePluginInstaller(
      fixture.scopeRoot,
      join(fixture.scopeRoot, "untrusted.db"),
      {},
      "0.2.0"
    );
    await expect(untrusted.installArchive(fixture.archive, fixture.release))
      .rejects.toThrow("trusted RouteMarket publisher key");
    untrusted.close();
    fixture.installer.close();
  });

  it("marks an installed plugin invalid when extracted contents are modified", async () => {
    const fixture = await createFixture();
    await fixture.installer.installArchive(fixture.archive, fixture.release);
    await writeFile(join(
      fixture.scopeRoot,
      "plugins",
      "packages",
      "ai.example.tables",
      "1.2.3",
      "resources",
      "help.txt"
    ), "modified after installation");

    await expect(fixture.installer.list()).resolves.toEqual([
      expect.objectContaining({ pluginId: "ai.example.tables", status: "invalid" })
    ]);
    fixture.installer.close();
  });

  it("supports account-space enable, disable, and uninstall lifecycle", async () => {
    const fixture = await createFixture();
    await fixture.installer.installArchive(fixture.archive, fixture.release);
    await expect(fixture.installer.setEnabled("ai.example.tables", false))
      .resolves.toMatchObject({ enabled: false, status: "ready" });
    await expect(fixture.installer.setEnabled("ai.example.tables", true))
      .resolves.toMatchObject({ enabled: true, status: "ready" });
    await expect(fixture.installer.remove("ai.example.tables")).resolves.toEqual({ removed: true });
    await expect(fixture.installer.list()).resolves.toEqual([]);
    fixture.installer.close();
  });

  it("installs a user-approved local directory into the same managed lifecycle", async () => {
    const fixture = await createFixture();
    const localRoot = join(fixture.root, "local-voice-studio");
    await mkdir(join(localRoot, ".routemarket-plugin"), { recursive: true });
    await mkdir(join(localRoot, "runtime"), { recursive: true });
    const localManifest = {
      schemaVersion: 2,
      id: "ai.example.voice-studio",
      name: "Voice Studio",
      description: "Local voice studio.",
      version: "0.1.0",
      publisher: "Example Publisher",
      kind: "desktop_extension",
      status: "available",
      distribution: { source: "local", packageFormat: "desktop-extension" },
      engines: { routemarketWork: ">=0.2.0" },
      permissions: ["process", "device.gpu"],
      activationEvents: ["onPage:studio"],
      runtime: {
        type: "local_process",
        command: "node",
        args: ["runtime/server.cjs"],
        transport: { type: "http", healthPath: "/health" }
      },
      resources: { models: [] },
      contributes: {
        viewers: [], tools: [], workflowNodes: [], connectors: [],
        navigation: [{ id: "voice", title: "Voice Studio", pageId: "studio", group: "creation", order: 10 }],
        pages: [{ id: "studio", title: "Voice Studio", source: "runtime", path: "/studio" }]
      }
    };
    await writeFile(join(localRoot, ".routemarket-plugin", "plugin.json"), JSON.stringify(localManifest));
    await writeFile(join(localRoot, "runtime", "server.cjs"), "console.log('voice studio')");

    const inspected = await fixture.installer.inspectLocalDirectory(localRoot);
    expect(inspected).toMatchObject({
      manifest: { id: "ai.example.voice-studio" },
      integrity: expect.stringMatching(/^sha256:/)
    });
    await writeFile(join(localRoot, "runtime", "server.cjs"), "console.log('changed after review')");
    await expect(fixture.installer.installLocalDirectory(localRoot, inspected.integrity))
      .rejects.toThrow("changed after the permission review");
    await writeFile(join(localRoot, "runtime", "server.cjs"), "console.log('voice studio')");
    const receipt = await fixture.installer.installLocalDirectory(localRoot);
    expect(receipt).toMatchObject({
      pluginId: "ai.example.voice-studio",
      source: "local",
      signerKeyId: "local-user-approved",
      enabled: true,
      status: "ready"
    });
    await expect(fixture.installer.listEnabledPackages()).resolves.toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: "ai.example.voice-studio" })
      })
    ]);
    await expect(fixture.installer.setEnabled("ai.example.voice-studio", false))
      .resolves.toMatchObject({ enabled: false });
    await expect(fixture.installer.remove("ai.example.voice-studio")).resolves.toEqual({ removed: true });
    fixture.installer.close();
  });

  it("rejects traversal paths before extracting any package files", async () => {
    const fixture = await createFixture({ unsafePath: true });
    await expect(fixture.installer.installArchive(fixture.archive, fixture.release))
      .rejects.toThrow("unsafe path");
    expect(await fixture.installer.list()).toEqual([]);
    fixture.installer.close();
  });

  it("binds the signature and manifest to the catalog identity", async () => {
    const fixture = await createFixture({ manifestPluginId: "ai.example.different" });
    await expect(fixture.installer.installArchive(fixture.archive, fixture.release))
      .rejects.toThrow("does not match");

    const modifiedRelease = { ...fixture.release, version: "1.2.4" };
    await expect(fixture.installer.installArchive(fixture.archive, modifiedRelease))
      .rejects.toThrow("signature verification");
    fixture.installer.close();
  });

  it("rejects a package that requires a newer host", async () => {
    const fixture = await createFixture({ minimumHostVersion: "9.0.0" });
    await expect(fixture.installer.installArchive(fixture.archive, fixture.release))
      .rejects.toThrow("newer RouteMarket Work");
    fixture.installer.close();
  });
});

async function createFixture(options: {
  unsafePath?: boolean;
  manifestPluginId?: string;
  minimumHostVersion?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "rm-plugin-installer-"));
  temporaryRoots.push(root);
  const scopeRoot = join(root, "scope");
  await mkdir(scopeRoot, { recursive: false });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifest = {
    schemaVersion: 1,
    id: options.manifestPluginId ?? "ai.example.tables",
    name: "Tables",
    description: "Declarative table tools.",
    version: "1.2.3",
    publisher: "Example Publisher",
    kind: "declarative_plugin",
    status: "available",
    distribution: { source: "marketplace", packageFormat: "declarative" },
    engines: { routemarketWork: ">=0.2.0" },
    permissions: ["project.read"],
    activationEvents: ["onTool:tables.inspect"],
    contributes: {
      viewers: [],
      tools: [{
        name: "tables.inspect",
        title: "Inspect table",
        status: "available",
        description: "Inspect a table.",
        capability: "local.table.read",
        risk: "R0"
      }],
      workflowNodes: [],
      connectors: []
    }
  };
  const zip = new JSZip();
  zip.file("package/.routemarket-plugin/plugin.json", JSON.stringify(manifest));
  zip.file("package/resources/help.txt", "safe declarative resource");
  if (options.unsafePath) zip.file("../escape.txt", "unsafe");
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const unsignedRelease = {
    pluginId: "ai.example.tables",
    publisher: "Example Publisher",
    version: "1.2.3",
    minimumHostVersion: options.minimumHostVersion ?? "0.2.0",
    integrity: marketplacePluginArchiveDigest(archive),
    signature: {
      algorithm: "ed25519" as const,
      keyId: "example.release.2026-01",
      value: ""
    }
  };
  const release: MarketplacePluginRelease = {
    ...unsignedRelease,
    signature: {
      ...unsignedRelease.signature,
      value: sign(null, marketplacePluginSignaturePayload(unsignedRelease), privateKey).toString("base64")
    }
  };
  const installer = new MarketplacePluginInstaller(
    scopeRoot,
    join(scopeRoot, "work.db"),
    { "example.release.2026-01": publicKey },
    "0.2.0"
  );
  return { root, scopeRoot, archive, release, installer };
}
