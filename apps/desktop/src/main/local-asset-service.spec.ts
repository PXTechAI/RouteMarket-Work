import { access, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetService } from "./local-asset-service";

const services: LocalAssetService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

describe("LocalAssetService", () => {
  it("registers zero-copy local references and keeps paths behind stable handles", async () => {
    const fixture = await createFixture();
    const sourcePath = join(fixture.root, "presenter.png");
    await writeFile(sourcePath, "local-media");

    const first = await fixture.service.register("ai.example.studio", {
      kind: "avatar",
      name: "Presenter",
      path: sourcePath,
      metadata: { role: "presenter" }
    });
    const duplicate = await fixture.service.register("ai.example.studio", {
      kind: "avatar",
      name: "Presenter updated",
      path: sourcePath
    });

    expect(first.uri).toBe(`rmasset://${first.id}`);
    expect(duplicate.id).toBe(first.id);
    expect(await fixture.service.list("ai.example.studio", "avatar")).toEqual([
      expect.objectContaining({
        id: first.id,
        name: "Presenter updated",
        source: expect.objectContaining({ fileName: "presenter.png", available: true })
      })
    ]);
    expect(await fixture.service.resolve(first.uri, "ai.example.studio")).toMatchObject({
      id: first.id,
      path: sourcePath
    });
  });

  it("detects moved files, relinks without changing the handle, and never deletes originals", async () => {
    const fixture = await createFixture();
    const sourcePath = join(fixture.root, "voice.wav");
    const movedPath = join(fixture.root, "voice-moved.wav");
    await writeFile(sourcePath, "voice");
    const asset = await fixture.service.register("ai.example.studio", {
      kind: "voice",
      path: sourcePath
    });
    await rename(sourcePath, movedPath);

    expect((await fixture.service.list("ai.example.studio"))[0]?.source.available).toBe(false);
    const relinked = await fixture.service.relink(asset.id, "ai.example.studio", movedPath);
    expect(relinked.id).toBe(asset.id);
    expect(relinked.source.available).toBe(true);
    expect(await fixture.service.remove(asset.id, "ai.example.studio")).toBe(true);
    await expect(access(movedPath)).resolves.toBeUndefined();
  });

  it("isolates private records and enforces plugin media permissions over loopback HTTP", async () => {
    const fixture = await createFixture();
    const sourcePath = join(fixture.root, "clip.mp4");
    await writeFile(sourcePath, "video");
    const owner = await fixture.service.createPluginSession("ai.owner", ["media.read"]);
    const denied = await fixture.service.createPluginSession("ai.denied", []);

    const created = await fetch(new URL("/v1/assets/register", owner.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ kind: "video", name: "Clip", path: sourcePath })
    });
    expect(created.status).toBe(201);
    const asset = await created.json() as { id: string; uri: string };

    const ownerList = await fetch(new URL("/v1/assets", owner.baseUrl), {
      headers: { authorization: `Bearer ${owner.token}` }
    });
    expect(await ownerList.json()).toEqual([expect.objectContaining({ id: asset.id })]);
    const deniedList = await fetch(new URL("/v1/assets", denied.baseUrl), {
      headers: { authorization: `Bearer ${denied.token}` }
    });
    expect(deniedList.status).toBe(403);
    await expect(fixture.service.resolve(asset.uri, "ai.other")).rejects.toThrow("not available");
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-assets-"));
  await mkdir(join(root, "db"), { recursive: true });
  const service = new LocalAssetService(join(root, "db", "assets.db"));
  services.push(service);
  return { root, service };
}
