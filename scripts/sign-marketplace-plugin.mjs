import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const required = [
  "package", "plugin-id", "publisher", "version", "minimum-host-version",
  "package-url", "key-id", "private-key", "out"
];
for (const name of required) {
  if (!options[name]) throw new Error(`Missing required --${name} argument.`);
}
if (!/^[a-z0-9][a-z0-9.-]{2,127}$/.test(options["plugin-id"])) throw new Error("Plugin ID is invalid.");
if (!options.publisher.trim() || options.publisher.length > 128 || /[\r\n\0]/.test(options.publisher)) throw new Error("Publisher is invalid.");
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(options.version) ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(options["minimum-host-version"])) {
  throw new Error("Plugin and minimum host versions must be semantic versions.");
}
const packageUrl = new URL(options["package-url"]);
if (packageUrl.protocol !== "https:" || packageUrl.username || packageUrl.password) {
  throw new Error("Package URL must use HTTPS and cannot include credentials.");
}
if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(options["key-id"])) throw new Error("Publisher key ID is invalid.");

const archive = await readFile(resolve(options.package));
if (!archive.length || archive.length > 32 * 1024 * 1024) throw new Error("Plugin package must be between 1 byte and 32 MB.");
const integrity = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
const releaseIdentity = {
  pluginId: options["plugin-id"],
  publisher: options.publisher,
  version: options.version,
  minimumHostVersion: options["minimum-host-version"],
  integrity
};
const privateKey = createPrivateKey(await readFile(resolve(options["private-key"]), "utf8"));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Marketplace signing key must use Ed25519.");
const signature = sign(null, signaturePayload(releaseIdentity), privateKey).toString("base64");
const release = {
  distributionSource: "marketplace",
  version: releaseIdentity.version,
  minimumHostVersion: releaseIdentity.minimumHostVersion,
  packageUrl: packageUrl.toString(),
  integrity,
  signature: {
    algorithm: "ed25519",
    keyId: options["key-id"],
    value: signature
  }
};
await writeFile(resolve(options.out), `${JSON.stringify(release, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600
});
process.stdout.write(`${options["plugin-id"]}@${options.version} signed with ${options["key-id"]}\n`);

function signaturePayload(release) {
  return Buffer.from([
    "routemarket-marketplace-plugin-v1",
    release.pluginId,
    release.publisher,
    release.version,
    release.minimumHostVersion,
    release.integrity,
    ""
  ].join("\n"), "utf8");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`Invalid argument near ${name ?? "end"}.`);
    const key = name.slice(2);
    if (parsed[key]) throw new Error(`Duplicate --${key} argument.`);
    parsed[key] = value;
  }
  return parsed;
}
