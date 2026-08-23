import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopAgentProfile } from "../shared/desktop-api";
import { AgentCatalogStore } from "./agent-catalog-store";

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = null;
});

function agent(revision = 3, id = "agent_builder"): DesktopAgentProfile {
  return {
    id,
    revision,
    origin: "template",
    forkSourceId: "fork_platform_builder",
    name: "Project Builder",
    description: "Build projects",
    avatarUrl: "https://assets.example.test/agent-builder.png",
    systemPrompt: "Build and verify.",
    greeting: null,
    starterQuestions: [],
    tags: ["official"],
    defaultModelCode: "gpt-5",
    skills: [],
    toolPermissions: [],
    executionPolicy: {
      environment: "auto",
      approvalMode: "risky_only"
    },
    tools: [],
    updatedAt: "2026-07-24T00:00:00.000Z"
  };
}

describe("AgentCatalogStore", () => {
  it("persists avatar and revision metadata across restarts", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-agent-cache-"));
    const databasePath = join(temporaryDirectory, "work.db");
    const first = new AgentCatalogStore(databasePath);
    first.replace([agent()]);
    first.close();

    const restored = new AgentCatalogStore(databasePath);
    expect(restored.list()).toEqual([
      expect.objectContaining({
        id: "agent_builder",
        revision: 3,
        avatarUrl: "https://assets.example.test/agent-builder.png"
      })
    ]);
    restored.close();
  });

  it("atomically replaces stale Agent revisions", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-agent-cache-"));
    const store = new AgentCatalogStore(join(temporaryDirectory, "work.db"));
    store.replace([agent(2)]);
    store.replace([agent(4)]);
    expect(store.list()).toEqual([
      expect.objectContaining({ id: "agent_builder", revision: 4 })
    ]);
    store.close();
  });

  it("preserves the server order used to select the default Agent", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-agent-cache-"));
    const databasePath = join(temporaryDirectory, "work.db");
    const first = new AgentCatalogStore(databasePath);
    first.replace([agent(1, "platform_primary"), agent(1, "personal_secondary")]);
    first.close();

    const restored = new AgentCatalogStore(databasePath);
    expect(restored.list().map((profile) => profile.id)).toEqual([
      "platform_primary",
      "personal_secondary"
    ]);
    restored.close();
  });

  it("migrates and deduplicates legacy space caches into one account cache", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-agent-cache-"));
    const firstSpacePath = join(temporaryDirectory, "spaces", "space_a", "work.db");
    const secondSpacePath = join(temporaryDirectory, "spaces", "space_b", "work.db");
    await mkdir(join(temporaryDirectory, "spaces", "space_a"), { recursive: true });
    await mkdir(join(temporaryDirectory, "spaces", "space_b"), { recursive: true });

    const firstSpace = new AgentCatalogStore(firstSpacePath);
    firstSpace.replace([agent(2, "shared"), agent(1, "only_a")]);
    firstSpace.close();
    const secondSpace = new AgentCatalogStore(secondSpacePath);
    secondSpace.replace([agent(4, "shared"), agent(1, "only_b")]);
    secondSpace.close();

    const accountStore = new AgentCatalogStore(join(temporaryDirectory, "agent-catalog.db"));
    expect(accountStore.migrateFrom([firstSpacePath, secondSpacePath])).toBe(4);
    expect(accountStore.list().map(({ id, revision }) => ({ id, revision }))).toEqual([
      { id: "shared", revision: 4 },
      { id: "only_a", revision: 1 },
      { id: "only_b", revision: 1 }
    ]);
    expect(accountStore.migrateFrom([firstSpacePath, secondSpacePath])).toBe(0);
    accountStore.close();
  });

  it("does not let an older space cache replace a newer account revision", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-agent-cache-"));
    const legacyPath = join(temporaryDirectory, "legacy.db");
    const legacy = new AgentCatalogStore(legacyPath);
    legacy.replace([agent(2, "shared")]);
    legacy.close();

    const accountStore = new AgentCatalogStore(join(temporaryDirectory, "account.db"));
    accountStore.replace([agent(5, "shared")]);
    expect(accountStore.migrateFrom([legacyPath])).toBe(0);
    expect(accountStore.list()[0]?.revision).toBe(5);
    accountStore.close();
  });

  it("ignores malformed legacy databases without leaking data across account files", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-agent-cache-"));
    const malformedPath = join(temporaryDirectory, "not-a-database.db");
    await writeFile(malformedPath, "not sqlite", "utf8");

    const firstAccount = new AgentCatalogStore(join(temporaryDirectory, "account-a.db"));
    expect(firstAccount.migrateFrom([malformedPath])).toBe(0);
    firstAccount.replace([agent(1, "account_a")]);
    firstAccount.close();

    const secondAccount = new AgentCatalogStore(join(temporaryDirectory, "account-b.db"));
    expect(secondAccount.list()).toEqual([]);
    secondAccount.close();
  });
});
