import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./project-registry";
import { searchProject } from "./project-search";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-search-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await mkdir(join(projectRoot, "node_modules"), { recursive: true });
  await writeFile(join(projectRoot, "src", "market.ts"), "const routeMarket = true;\n", "utf8");
  await writeFile(join(projectRoot, "README.md"), "# RouteMarket\nAnother RouteMarket line\n", "utf8");
  await writeFile(join(projectRoot, "node_modules", "secret.txt"), "RouteMarket", "utf8");
  const registry = new ProjectRegistry(join(root, "worker.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  return { root, projectRoot, registry, project };
}

describe("project search", () => {
  it("finds path and content matches with line information", async () => {
    const value = await fixture();
    const result = await searchProject(value.registry, value.project.localProjectId, "market");
    expect(result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "src/market.ts", matchKind: "path" }),
      expect.objectContaining({ relativePath: "src/market.ts", matchKind: "content", line: 1 }),
      expect.objectContaining({ relativePath: "README.md", matchKind: "content", line: 1 }),
      expect.objectContaining({ relativePath: "README.md", matchKind: "content", line: 2 })
    ]));
    expect(result.matches.some((match) => match.relativePath.includes("node_modules"))).toBe(false);
  });

  it("does not follow linked directories", async () => {
    const value = await fixture();
    const outside = join(value.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "needle", "utf8");
    await symlink(
      outside,
      join(value.projectRoot, "outside-link"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const result = await searchProject(value.registry, value.project.localProjectId, "needle");
    expect(result.matches).toEqual([]);
  });

  it("caps result count and validates input", async () => {
    const value = await fixture();
    const result = await searchProject(
      value.registry,
      value.project.localProjectId,
      "RouteMarket",
      { maxResults: 1 }
    );
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
    await expect(searchProject(value.registry, value.project.localProjectId, " "))
      .rejects.toMatchObject({ code: "TOOL_INPUT_INVALID" });
  });
});
