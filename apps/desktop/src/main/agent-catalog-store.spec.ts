import { mkdtemp, rm } from "node:fs/promises";
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

function agent(revision = 3): DesktopAgentProfile {
  return {
    id: "agent_builder",
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
});
