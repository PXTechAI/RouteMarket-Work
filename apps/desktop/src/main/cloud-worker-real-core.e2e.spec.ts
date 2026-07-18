import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JobStore,
  ProjectRegistry,
  projectBindingIdFor,
  type LocalProject
} from "@routemarket/work-worker-core";
import { CloudJobRuntime } from "../worker/cloud-job-runtime";
import { CloudWorkerClient, type CloudWorkerTransport } from "./cloud-worker-client";

const E2E_ENABLED = process.env.ROUTEMARKET_CORE_E2E === "1";
const CORE_PORT = Number(process.env.ROUTEMARKET_CORE_E2E_PORT || 43101);
const API_BASE_URL = `http://127.0.0.1:${CORE_PORT}`;
const WORK_API_URL = `${API_BASE_URL}/api/app/v1/work`;
const INSTALLATION_ID = `work-e2e-${randomUUID()}`;
const ACCESS_TOKEN = `rmw_dt_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
type CoreProcess = ReturnType<typeof startCore>;
const coreOutput = new WeakMap<CoreProcess, string>();

type PrismaClientLike = {
  $disconnect(): Promise<void>;
  userAccount: any;
  membershipPlan: any;
  userMembership: any;
  desktopAccessToken: any;
  desktopRuntime: any;
  desktopJob: any;
  desktopProjectBinding: any;
  workflowRun: any;
  workflowNodeRun: any;
};

describe.runIf(E2E_ENABLED)("CloudWorkerClient with a real local Core", () => {
  let coreRoot = "";
  let coreProcess: CoreProcess | null = null;
  let prisma: PrismaClientLike;
  let userId = "";
  let planId = "";
  let tempRoot = "";
  let registry: ProjectRegistry;
  let jobStore: JobStore;
  let project: Awaited<ReturnType<ProjectRegistry["bindFolder"]>>;
  let worker: CloudJobRuntime;
  let client: CloudWorkerClient;

  beforeAll(async () => {
    if (CORE_PORT === 3001) {
      throw new Error("The Core E2E test must never use port 3001.");
    }
    await assertPortAvailable(CORE_PORT);
    coreRoot = resolveCoreRoot();
    loadCoreEnvironment(coreRoot);
    prisma = await loadCorePrisma(coreRoot);
    ({ userId, planId } = await seedIdentity(prisma));

    tempRoot = await mkdtemp(resolve(tmpdir(), "routemarket-work-core-e2e-"));
    const projectRoot = resolve(tempRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      resolve(projectRoot, "README.md"),
      "RouteMarket Work real Core E2E fixture.\n",
      "utf8"
    );
    registry = new ProjectRegistry(resolve(tempRoot, "work.db"));
    project = await registry.bindFolder(projectRoot);
    jobStore = new JobStore(resolve(tempRoot, "work.db"));
    worker = new CloudJobRuntime(registry, jobStore);

    const startedCore = startCore(coreRoot);
    coreProcess = startedCore;
    await waitForCore(startedCore);

    client = new CloudWorkerClient({
      apiBaseUrl: API_BASE_URL,
      installationId: INSTALLATION_ID,
      deviceName: "RouteMarket Work E2E",
      platform: "windows",
      arch: "x64",
      appVersion: "0.1.0-e2e",
      workerVersion: "0.1.0-e2e",
      workerClient: createTransport(project, worker),
      onActivity: () => undefined,
      socketFactory: false
    });
    client.setAccessToken(ACCESS_TOKEN);
    await client.start();
    await waitFor(() => client.getState().status === "online", "Cloud Worker did not connect.");
  }, 120_000);

  afterAll(async () => {
    client?.stop();
    if (coreProcess && !coreProcess.killed) {
      coreProcess.kill();
      await waitForProcessExit(coreProcess);
    }
    registry?.close();
    jobStore?.close();
    if (prisma && userId) {
      await prisma.desktopJob.deleteMany({ where: { userId } });
      await prisma.workflowRun.deleteMany({ where: { userId } });
      await prisma.desktopProjectBinding.deleteMany({ where: { userId } });
      await prisma.desktopRuntime.deleteMany({ where: { userId } });
      await prisma.desktopAccessToken.deleteMany({ where: { userId } });
      await prisma.userMembership.deleteMany({ where: { userId } });
      await prisma.userAccount.deleteMany({ where: { id: userId } });
      if (planId) {
        await prisma.membershipPlan.deleteMany({ where: { id: planId } });
      }
      await prisma.$disconnect();
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("executes a linked Desktop Job, writes node output and resumes the Workflow", async () => {
    const state = client.getState();
    expect(state.runtimeId).toMatch(/^runtime_/);
    const bindingId = projectBindingIdFor(project.localProjectId);
    const nodeId = "desktop_read";
    const graphSnapshot = {
      nodes: [
        {
          id: nodeId,
          title: "Read README",
          nodeType: "desktop.local_fs_read",
          kind: "workflow",
          executionMode: "transform",
          joinStrategy: "passthrough",
          prompt: null,
          model: null,
          resourceType: null,
          resourceUrl: null,
          resourceMimeType: null,
          resourceFileName: null,
          storyboardSourceMode: null,
          generationOutput: null,
          generationSize: null,
          generationDurationSeconds: null,
          generationQuality: null,
          generationStyle: null,
          generationCount: null,
          inputPorts: [],
          outputPorts: [
            {
              id: "text-output",
              label: "Text",
              accepts: [],
              produces: ["text"],
              required: false
            }
          ],
          runtime: { executorKey: "local.fs.read" },
          channelGroupBindings: {},
          desktopRuntimeId: state.runtimeId,
          desktopProjectBindingId: bindingId,
          desktopProjectUri: `project://${project.localProjectId}/README.md`,
          desktopMaxBytes: 65_536
        }
      ],
      edges: []
    };
    const run = await prisma.workflowRun.create({
      data: {
        userId,
        status: "waiting_desktop",
        graphSnapshot
      }
    });
    const nodeRun = await prisma.workflowNodeRun.create({
      data: {
        runId: run.id,
        nodeId,
        executorKey: "local.fs.read",
        executorFamily: "desktop",
        stage: 1,
        status: "waiting_desktop",
        attempts: 0
      }
    });
    const jobBody = {
      runtime_id: state.runtimeId,
      project_binding_id: bindingId,
      workflow_run_id: run.id,
      workflow_node_run_id: nodeRun.id,
      executor_key: "local.fs.read",
      executor_version: 1,
      input: {
        uri: `project://${project.localProjectId}/README.md`,
        maxBytes: 65_536
      },
      required_capabilities: ["local.fs.read"],
      execution_class: "pure_read",
      approval_policy: { risk: "R0", mode: "project_grant" },
      idempotency_key: `sha256:${createHash("sha256")
        .update(`core-e2e:${run.id}`)
        .digest("hex")}`,
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
      max_inline_result_bytes: 262_144
    };

    const created = await workRequest<{ jobId: string }>("/jobs", {
      method: "POST",
      body: jobBody
    });
    const duplicate = await workRequest<{ jobId: string }>("/jobs", {
      method: "POST",
      body: jobBody
    });
    expect(duplicate.jobId).toBe(created.jobId);

    try {
      await waitFor(async () => {
        const current = await prisma.workflowRun.findUnique({ where: { id: run.id } });
        return current?.status === "succeeded";
      }, "Workflow did not resume after the Desktop result.", 20_000);
    } catch (error) {
      const diagnostics = await collectDiagnostics({
        prisma,
        worker,
        client,
        coreProcess,
        runId: run.id,
        nodeRunId: nodeRun.id,
        jobId: created.jobId
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(diagnostics, null, 2)}`
      );
    }

    const persistedJob = await prisma.desktopJob.findUnique({
      where: { jobId: created.jobId }
    });
    const persistedNode = await prisma.workflowNodeRun.findUnique({
      where: { id: nodeRun.id }
    });
    const persistedRun = await prisma.workflowRun.findUnique({ where: { id: run.id } });

    expect(persistedJob).toMatchObject({
      status: "succeeded",
      workflowRunId: run.id,
      workflowNodeRunId: nodeRun.id
    });
    expect(persistedJob.output).toMatchObject({
      text: "RouteMarket Work real Core E2E fixture.\n"
    });
    expect(persistedNode).toMatchObject({
      status: "succeeded",
      attempts: 1
    });
    expect(persistedNode.outputsByPort).toMatchObject({
      "text-output": [
        expect.objectContaining({
          text: "RouteMarket Work real Core E2E fixture.\n",
          sourceNodeId: nodeId
        })
      ]
    });
    expect(persistedRun).toMatchObject({
      status: "succeeded"
    });
  }, 60_000);

  it("rejects project escape attempts and stops retrying after device revocation", async () => {
    const state = client.getState();
    const bindingId = projectBindingIdFor(project.localProjectId);
    const rejected = await fetch(`${WORK_API_URL}/jobs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        runtime_id: state.runtimeId,
        project_binding_id: bindingId,
        executor_key: "local.fs.read",
        executor_version: 1,
        input: {
          uri: "project://project_not_granted/README.md",
          maxBytes: 65_536
        },
        required_capabilities: ["local.fs.read"],
        execution_class: "pure_read",
        approval_policy: { risk: "R0", mode: "project_grant" },
        idempotency_key: `sha256:${createHash("sha256")
          .update(`forbidden:${randomUUID()}`)
          .digest("hex")}`,
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
        max_inline_result_bytes: 262_144
      })
    });
    expect(rejected.status).toBe(403);

    await prisma.desktopRuntime.update({
      where: { runtimeId: state.runtimeId },
      data: { status: "disabled" }
    });
    await waitFor(
      () => client.getState().status === "access_required",
      "Revoked Runtime did not enter access_required.",
      8_000
    );
    expect(client.getState().error).toBe("Desktop runtime has been revoked.");
  }, 20_000);
});

function resolveCoreRoot() {
  const workRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
  const root = resolve(
    process.env.ROUTEMARKET_CORE_DIR || resolve(workRoot, "..", "..", "RouteMarket-Core")
  );
  const mainPath = resolve(root, "apps", "core-api", "dist", "main.js");
  if (!existsSync(mainPath)) {
    throw new Error(`Built RouteMarket Core was not found at ${mainPath}.`);
  }
  return root;
}

function loadCoreEnvironment(root: string) {
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

async function loadCorePrisma(root: string): Promise<PrismaClientLike> {
  const clientPath = resolve(root, "packages", "database", "dist", "client.js");
  const module = await import(`${pathToFileURL(clientPath).href}?e2e=${Date.now()}`);
  return module.prisma as PrismaClientLike;
}

async function seedIdentity(client: PrismaClientLike) {
  const suffix = randomUUID().replaceAll("-", "");
  const plan = await client.membershipPlan.create({
    data: {
      code: `work_e2e_${suffix}`,
      name: "RouteMarket Work E2E",
      tier: "personal",
      billingPeriod: "monthly",
      features: { work: true }
    }
  });
  const user = await client.userAccount.create({
    data: {
      email: `work-e2e-${suffix}@example.invalid`,
      displayName: "RouteMarket Work E2E",
      role: "user",
      status: "active"
    }
  });
  const now = new Date();
  await client.userMembership.create({
    data: {
      userId: user.id,
      planId: plan.id,
      status: "active",
      startedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      nextGrantAt: new Date(now.getTime() + 60 * 60_000),
      grantsIssuedCount: 0,
      grantsTotal: 1
    }
  });
  await client.desktopAccessToken.create({
    data: {
      userId: user.id,
      installationId: INSTALLATION_ID,
      tokenHash: createHash("sha256").update(ACCESS_TOKEN).digest("hex"),
      status: "active",
      scopes: ["work:runtime", "work:projects", "work:jobs", "work:chat"],
      deviceName: "RouteMarket Work E2E",
      platform: "windows",
      arch: "x64",
      appVersion: "0.1.0-e2e",
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      metadata: {}
    }
  });
  return { userId: user.id as string, planId: plan.id as string };
}

function startCore(root: string) {
  const mainPath = resolve(root, "apps", "core-api", "dist", "main.js");
  const child = spawn(process.execPath, [mainPath], {
    cwd: root,
    env: {
      ...process.env,
      CORE_API_PORT: String(CORE_PORT),
      THROTTLE_LIMIT: "10000",
      AUTH_THROTTLE_LIMIT: "10000",
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  coreOutput.set(child, "");
  const appendOutput = (chunk: unknown) => {
    coreOutput.set(child, `${coreOutput.get(child) ?? ""}${String(chunk)}`.slice(-12_000));
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  return child;
}

async function waitForCore(process: CoreProcess) {
  await waitFor(async () => {
    if (process.exitCode !== null) {
      throw new Error(`Core exited with code ${process.exitCode}.\n${coreOutput.get(process) ?? ""}`);
    }
    return fetch(`${API_BASE_URL}/health`)
      .then((response) => response.ok)
      .catch(() => false);
  }, `Core did not become healthy.\n${coreOutput.get(process) ?? ""}`, 30_000);
}

async function collectDiagnostics(input: {
  prisma: PrismaClientLike;
  worker: CloudJobRuntime;
  client: CloudWorkerClient;
  coreProcess: CoreProcess | null;
  runId: string;
  nodeRunId: string;
  jobId: string;
}) {
  const [job, run, nodeRun, localEvents] = await Promise.all([
    input.prisma.desktopJob.findUnique({
      where: { jobId: input.jobId },
      include: { events: { orderBy: { sequence: "asc" } } }
    }),
    input.prisma.workflowRun.findUnique({ where: { id: input.runId } }),
    input.prisma.workflowNodeRun.findUnique({ where: { id: input.nodeRunId } }),
    input.worker.pendingEvents()
  ]);
  return {
    client: input.client.getState(),
    job,
    run,
    nodeRun,
    localPendingEvents: localEvents,
    coreOutput: input.coreProcess ? coreOutput.get(input.coreProcess) ?? "" : ""
  };
}

function createTransport(
  localProject: LocalProject,
  runtime: CloudJobRuntime
): CloudWorkerTransport {
  return {
    listProjects: async () => [
      {
        localProjectId: localProject.localProjectId,
        displayName: localProject.displayName,
        rootFingerprint: localProject.rootFingerprint,
        createdAt: localProject.createdAt,
        updatedAt: localProject.updatedAt
      }
    ],
    listMcpServers: async () => [],
    executeJob: (job, leaseId, leaseEpoch) =>
      runtime.executeJob({ job, leaseId, leaseEpoch }),
    cancelJob: async (jobId, leaseId, leaseEpoch) =>
      runtime.cancelJob(jobId, leaseId, leaseEpoch),
    pendingEvents: async () => runtime.pendingEvents(),
    eventsFrom: async (jobId, sequence) => runtime.eventsFrom(jobId, sequence),
    recoveryState: async () => runtime.recoveryState(),
    acknowledgeEvent: async (eventId) => runtime.acknowledgeEvent(eventId)
  };
}

async function workRequest<TResult>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<TResult> {
  const response = await fetch(`${WORK_API_URL}${path}`, {
    method: options.method || "GET",
    headers: authHeaders(),
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Core returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as TResult;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    "Content-Type": "application/json"
  };
}

async function assertPortAvailable(port: number) {
  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => error ? reject(error) : resolvePromise());
    });
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(message);
}

async function waitForProcessExit(process: CoreProcess) {
  if (process.exitCode !== null) return;
  await Promise.race([
    new Promise<void>((resolvePromise) => process.once("exit", () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5_000))
  ]);
}
