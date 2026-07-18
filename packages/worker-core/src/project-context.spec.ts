import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectContext } from "./project-context";
import { ProjectRegistry } from "./project-registry";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "routemarket-context-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  await mkdir(join(projectRoot, ".routemarket", "skills", "review"), { recursive: true });
  const registry = new ProjectRegistry(join(root, "work.db"));
  cleanups.push(async () => registry.close());
  const project = await registry.bindFolder(projectRoot);
  return { root, projectRoot, registry, project };
}

describe("loadProjectContext", () => {
  it("loads project instructions, README, validated settings and project Skills", async () => {
    const value = await fixture();
    await writeFile(join(value.projectRoot, "AGENTS.md"), "Use TypeScript.\n", "utf8");
    await writeFile(join(value.projectRoot, "README.md"), "# Example\n", "utf8");
    await writeFile(join(value.projectRoot, ".routemarket", "project.json"), JSON.stringify({
      defaultAgent: "reviewer",
      defaultModel: "gpt-test",
      cloudProjectId: "cloud_project_1",
      ignore: ["generated/**", "generated/**", "*.secret"]
    }), "utf8");
    await writeFile(
      join(value.projectRoot, ".routemarket", "skills", "review", "SKILL.md"),
      "---\nname: Code review\ndescription: Review changes safely.\n---\n# Instructions\n",
      "utf8"
    );

    await expect(loadProjectContext(value.registry, value.project.localProjectId)).resolves.toEqual({
      instructions: {
        relativePath: "AGENTS.md",
        text: "Use TypeScript.\n",
        truncated: false
      },
      readme: { relativePath: "README.md", text: "# Example\n", truncated: false },
      settings: {
        defaultAgent: "reviewer",
        defaultModel: "gpt-test",
        cloudProjectId: "cloud_project_1",
        ignore: ["generated/**", "*.secret"]
      },
      skills: [{
        id: "review",
        name: "Code review",
        description: "Review changes safely.",
        relativePath: ".routemarket/skills/review/SKILL.md"
      }]
    });
  });

  it("rejects malformed project settings", async () => {
    const value = await fixture();
    await writeFile(join(value.projectRoot, ".routemarket", "project.json"), "{broken", "utf8");
    await expect(loadProjectContext(value.registry, value.project.localProjectId)).rejects.toMatchObject({
      code: "PROJECT_SETTINGS_INVALID"
    });
  });

  it("does not discover Skills through a symlink outside the project", async () => {
    const value = await fixture();
    const outside = join(value.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "SKILL.md"), "# Escaped\n", "utf8");
    const linked = join(value.projectRoot, ".routemarket", "skills", "linked");
    await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");

    const context = await loadProjectContext(value.registry, value.project.localProjectId);
    expect(context.skills).toEqual([]);
  });
});
