import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { DesktopJob, JobEvent } from "@routemarket/work-protocol";
import {
  executeLocalSkillInvoke,
  inspectProjectSkillPackage,
  JobStore,
  loadProjectContext,
  ProjectRegistry,
  projectBindingIdFor,
  type LocalProject,
  type ProjectSkillPackageIdentity
} from "@routemarket/work-worker-core";
import { CloudJobRuntime } from "../worker/cloud-job-runtime";
import {
  CloudWorkerClient,
  type CloudSkillSigner,
  type CloudWorkerTransport
} from "./cloud-worker-client";
import { RouteMarketApiClient } from "./routemarket-api-client";

const E2E_ENABLED = process.env.ROUTEMARKET_CORE_E2E === "1";
const CORE_PORT = Number(process.env.ROUTEMARKET_CORE_E2E_PORT || 43101);
const API_BASE_URL = `http://127.0.0.1:${CORE_PORT}`;
const WORK_API_URL = `${API_BASE_URL}/api/app/v1/work`;
const INSTALLATION_ID = `work-e2e-${randomUUID()}`;
const ACCESS_TOKEN = `rmw_dt_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
type CoreProcess = ReturnType<typeof startCore>;
const coreOutput = new WeakMap<CoreProcess, string>();
type WorkerActivity = {
  kind: string;
  title: string;
  detail: string;
};
type ExternalJobControl = {
  started: Deferred;
  aborted: Deferred;
  release: Deferred;
};
type ApprovalDecision = "approved" | "denied";
type ApprovalJobControl = {
  requested: Deferred;
  resolved: Deferred;
  release: Deferred;
  decision: Promise<ApprovalDecision>;
  resolveDecision: (decision: ApprovalDecision) => void;
};
type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

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
  let workerActivities: WorkerActivity[] = [];
  let externalJobControl: ExternalJobControl | null = null;
  let approvalJobControl: ApprovalJobControl | null = null;
  let runtimeChannelOpened: Deferred;
  let skillSigning: ReturnType<typeof createE2ESkillSigner>;

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
    const skillRoot = resolve(projectRoot, ".routemarket", "skills", "review");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      resolve(skillRoot, "SKILL.md"),
      [
        "---",
        "name: Core E2E review",
        "description: Verify the signed local Skill control-plane path.",
        "version: 1.0.0",
        "---",
        "Review the bound project and return a concise report."
      ].join("\n"),
      "utf8"
    );
    registry = new ProjectRegistry(resolve(tempRoot, "work.db"));
    project = await registry.bindFolder(projectRoot);
    jobStore = new JobStore(resolve(tempRoot, "work.db"));
    worker = new CloudJobRuntime(registry, jobStore);
    skillSigning = createE2ESkillSigner();

    const startedCore = startCore(coreRoot);
    coreProcess = startedCore;
    await waitForCore(startedCore);

    workerActivities = [];
    runtimeChannelOpened = deferred();
    client = new CloudWorkerClient({
      apiClient: new RouteMarketApiClient({
        baseUrl: API_BASE_URL,
        appVersion: "0.1.0"
      }),
      installationId: INSTALLATION_ID,
      deviceName: "RouteMarket Work E2E",
      platform: "windows",
      arch: "x64",
      appVersion: "0.1.0-e2e",
      workerVersion: "0.1.0-e2e",
      workerClient: createTransport(project, registry, worker),
      skillSigner: skillSigning.signer,
      onActivity: (kind, title, detail) => {
        workerActivities.push({ kind, title, detail });
      },
      executeDesktopJob: (job, leaseId, leaseEpoch, signal, emitEvents) =>
        executeControlledExternalJob(
          worker,
          registry,
          externalJobControl,
          approvalJobControl,
          job,
          leaseId,
          leaseEpoch,
          signal,
          emitEvents
        ),
      socketFactory: (url, token) => {
        const socket = new WebSocket(url, {
          headers: { Authorization: `Bearer ${token}` }
        });
        socket.once("open", runtimeChannelOpened.resolve);
        return socket;
      }
    });
    client.setAccessToken(ACCESS_TOKEN);
    await client.start();
    try {
      await waitFor(() => client.getState().status === "online", "Cloud Worker did not connect.");
    } catch (error) {
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          JSON.stringify(
            {
              client: client.getState(),
              activities: workerActivities,
              coreOutput: coreOutput.get(startedCore) ?? ""
            },
            null,
            2
          )
        ].join("\n")
      );
    }
    await waitFor(
      () => runtimeChannelOpened.promise.then(() => true),
      "Cloud Worker runtime channel did not open."
    );
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

  it("executes a device-signed local Skill through Core after R3 approval", async () => {
    const state = client.getState();
    const identity = skillSigning.current();
    expect(identity).toBeTruthy();
    const control = createApprovalJobControl();
    approvalJobControl = control;
    let created: { jobId: string } | null = null;

    try {
      created = await workRequest<{ jobId: string }>("/jobs", {
        method: "POST",
        body: {
          runtime_id: state.runtimeId,
          project_binding_id: identity.projectBindingId,
          workflow_run_id: null,
          workflow_node_run_id: null,
          executor_key: "local.skill.invoke",
          executor_version: 1,
          input: {
            skillId: identity.skillId,
            version: identity.version,
            packageDigest: identity.packageDigest,
            signingKeyId: skillSigning.keyId,
            operation: "invoke",
            task: "Review the Core E2E fixture."
          },
          required_capabilities: ["local.skill.invoke"],
          execution_class: "external_side_effect",
          approval_policy: { risk: "R3", mode: "invocation" },
          idempotency_key: `sha256:${createHash("sha256")
            .update(`core-e2e-local-skill:${identity.packageDigest}`)
            .digest("hex")}`,
          deadline_at: new Date(Date.now() + 60_000).toISOString(),
          max_inline_result_bytes: 262_144
        }
      });
      await control.requested.promise;
      control.resolveDecision("approved");
      await control.resolved.promise;
      control.release.resolve();

      await waitFor(async () => {
        const job = await prisma.desktopJob.findUnique({
          where: { jobId: created!.jobId }
        });
        return job?.status === "succeeded";
      }, "Signed local Skill job did not complete.", 20_000);

      const persistedJob = await prisma.desktopJob.findUnique({
        where: { jobId: created.jobId },
        include: { events: { orderBy: { sequence: "asc" } } }
      });
      expect(persistedJob.output).toMatchObject({
        skillId: "review",
        version: "1.0.0",
        task: "Review the Core E2E fixture.",
        instructions: expect.stringContaining("Review the bound project")
      });
      expect(persistedJob.events.map((event: { type: string }) => event.type)).toEqual([
        "job.accepted",
        "job.started",
        "approval.requested",
        "approval.resolved",
        "job.succeeded"
      ]);
    } finally {
      control.resolveDecision("denied");
      control.release.resolve();
      approvalJobControl = null;
    }
  }, 60_000);

  it("cancels a running Desktop Job through the runtime channel", async () => {
    const state = client.getState();
    const bindingId = projectBindingIdFor(project.localProjectId);
    const nodeId = "desktop_browser_navigate";
    const graphSnapshot = {
      nodes: [
        {
          id: nodeId,
          title: "Open cancellation fixture",
          nodeType: "desktop.local_browser_navigate",
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
          runtime: { executorKey: "local.browser.navigate" },
          channelGroupBindings: {},
          desktopRuntimeId: state.runtimeId,
          desktopProjectBindingId: bindingId,
          desktopUrl: "https://example.invalid/cancel-me"
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
        executorKey: "local.browser.navigate",
        executorFamily: "desktop",
        stage: 1,
        status: "waiting_desktop",
        attempts: 0
      }
    });
    externalJobControl = {
      started: deferred(),
      aborted: deferred(),
      release: deferred()
    };

    let created: { jobId: string };
    try {
      created = await workRequest<{ jobId: string }>("/jobs", {
        method: "POST",
        body: {
          runtime_id: state.runtimeId,
          project_binding_id: bindingId,
          workflow_run_id: run.id,
          workflow_node_run_id: nodeRun.id,
          executor_key: "local.browser.navigate",
          executor_version: 1,
          input: { url: "https://example.invalid/cancel-me" },
          required_capabilities: ["local.browser.navigate"],
          execution_class: "external_side_effect",
          approval_policy: { risk: "R1", mode: "invocation" },
          idempotency_key: `sha256:${createHash("sha256")
            .update(`core-e2e-cancel:${run.id}`)
            .digest("hex")}`,
          deadline_at: new Date(Date.now() + 60_000).toISOString(),
          max_inline_result_bytes: 262_144
        }
      });
    } catch (error) {
      externalJobControl.release.resolve();
      externalJobControl = null;
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          coreProcess ? coreOutput.get(coreProcess) ?? "" : ""
        ].join("\n")
      );
    }

    try {
      await externalJobControl.started.promise;
      await waitFor(async () => {
        const current = await prisma.desktopJob.findUnique({
          where: { jobId: created.jobId }
        });
        return current?.status === "running";
      }, "Desktop Job did not enter running before cancellation.");

      const cancellation = await workRequest<{ status: string }>(
        `/jobs/${created.jobId}/cancel`,
        { method: "POST" }
      );
      expect(cancellation.status).toBe("cancel_requested");
      await externalJobControl.aborted.promise;

      await waitFor(async () => {
        const [job, workflowRun, workflowNodeRun] = await Promise.all([
          prisma.desktopJob.findUnique({ where: { jobId: created.jobId } }),
          prisma.workflowRun.findUnique({ where: { id: run.id } }),
          prisma.workflowNodeRun.findUnique({ where: { id: nodeRun.id } })
        ]);
        return (
          job?.status === "canceled" &&
          workflowRun?.status === "canceled" &&
          workflowNodeRun?.status === "failed"
        );
      }, "Running Desktop Job cancellation did not converge.", 20_000);

      expect(jobStore.getStatus(created.jobId)).toBe("canceled");
      expect(workerActivities).toContainEqual({
        kind: "job.canceled",
        title: "Cloud job canceled",
        detail: created.jobId
      });
      const persistedJob = await prisma.desktopJob.findUnique({
        where: { jobId: created.jobId },
        include: { events: { orderBy: { sequence: "asc" } } }
      });
      expect(persistedJob).toMatchObject({
        status: "canceled",
        cancelRequested: true
      });
      expect(persistedJob.events.map((event: { type: string }) => event.type)).toEqual([
        "job.accepted",
        "job.started",
        "job.canceled"
      ]);
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
    } finally {
      externalJobControl.release.resolve();
      externalJobControl = null;
    }
  }, 60_000);

  it("waits for local approval before completing a Desktop Job", async () => {
    const state = client.getState();
    const bindingId = projectBindingIdFor(project.localProjectId);
    const fixture = await createApprovalWorkflowFixture({
      prisma,
      userId,
      runtimeId: state.runtimeId!,
      bindingId,
      suffix: "approved",
      url: "https://example.invalid/approved"
    });
    const control = createApprovalJobControl();
    approvalJobControl = control;

    let created: { jobId: string } | null = null;
    try {
      created = await workRequest<{ jobId: string }>("/jobs", {
        method: "POST",
        body: fixture.jobBody
      });
      const jobId = created.jobId;
      await control.requested.promise;
      await waitFor(async () => {
        const [workflowRun, workflowNodeRun] = await Promise.all([
          prisma.workflowRun.findUnique({ where: { id: fixture.run.id } }),
          prisma.workflowNodeRun.findUnique({ where: { id: fixture.nodeRun.id } })
        ]);
        return (
          workflowRun?.status === "waiting_approval" &&
          workflowNodeRun?.status === "waiting_approval"
        );
      }, "Workflow did not enter waiting_approval.");

      control.resolveDecision("approved");
      await control.resolved.promise;
      await waitFor(async () => {
        const [workflowRun, workflowNodeRun] = await Promise.all([
          prisma.workflowRun.findUnique({ where: { id: fixture.run.id } }),
          prisma.workflowNodeRun.findUnique({ where: { id: fixture.nodeRun.id } })
        ]);
        return (
          workflowRun?.status === "waiting_desktop" &&
          workflowNodeRun?.status === "waiting_desktop"
        );
      }, "Approved Workflow did not return to waiting_desktop.");
      control.release.resolve();

      await waitFor(async () => {
        const [job, workflowRun, workflowNodeRun] = await Promise.all([
          prisma.desktopJob.findUnique({ where: { jobId } }),
          prisma.workflowRun.findUnique({ where: { id: fixture.run.id } }),
          prisma.workflowNodeRun.findUnique({ where: { id: fixture.nodeRun.id } })
        ]);
        return (
          job?.status === "succeeded" &&
          workflowRun?.status === "succeeded" &&
          workflowNodeRun?.status === "succeeded"
        );
      }, "Approved Desktop Job did not complete.", 20_000);

      const persistedJob = await prisma.desktopJob.findUnique({
        where: { jobId },
        include: { events: { orderBy: { sequence: "asc" } } }
      });
      expect(persistedJob.events.map((event: { type: string }) => event.type)).toEqual([
        "job.accepted",
        "job.started",
        "approval.requested",
        "approval.resolved",
        "job.succeeded"
      ]);
      expect(persistedJob.events[3].payload).toMatchObject({
        decision: "approved"
      });
    } catch (error) {
      const diagnostics = await collectDiagnostics({
        prisma,
        worker,
        client,
        coreProcess,
        runId: fixture.run.id,
        nodeRunId: fixture.nodeRun.id,
        jobId: created?.jobId ?? "not-created"
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(diagnostics, null, 2)}`
      );
    } finally {
      control.resolveDecision("denied");
      control.release.resolve();
      approvalJobControl = null;
    }
  }, 60_000);

  it("fails a Desktop Job when local approval is denied", async () => {
    const state = client.getState();
    const bindingId = projectBindingIdFor(project.localProjectId);
    const fixture = await createApprovalWorkflowFixture({
      prisma,
      userId,
      runtimeId: state.runtimeId!,
      bindingId,
      suffix: "denied",
      url: "https://example.invalid/denied"
    });
    const control = createApprovalJobControl();
    approvalJobControl = control;

    let created: { jobId: string } | null = null;
    try {
      created = await workRequest<{ jobId: string }>("/jobs", {
        method: "POST",
        body: fixture.jobBody
      });
      const jobId = created.jobId;
      await control.requested.promise;
      await waitFor(async () => {
        const [workflowRun, workflowNodeRun] = await Promise.all([
          prisma.workflowRun.findUnique({ where: { id: fixture.run.id } }),
          prisma.workflowNodeRun.findUnique({ where: { id: fixture.nodeRun.id } })
        ]);
        return (
          workflowRun?.status === "waiting_approval" &&
          workflowNodeRun?.status === "waiting_approval"
        );
      }, "Denied Workflow did not enter waiting_approval.");

      control.resolveDecision("denied");
      await control.resolved.promise;
      await waitFor(async () => {
        const [workflowRun, workflowNodeRun] = await Promise.all([
          prisma.workflowRun.findUnique({ where: { id: fixture.run.id } }),
          prisma.workflowNodeRun.findUnique({ where: { id: fixture.nodeRun.id } })
        ]);
        return (
          workflowRun?.status === "waiting_desktop" &&
          workflowNodeRun?.status === "waiting_desktop"
        );
      }, "Denied Workflow did not return to waiting_desktop after resolution.");
      control.release.resolve();

      await waitFor(async () => {
        const [job, workflowRun, workflowNodeRun] = await Promise.all([
          prisma.desktopJob.findUnique({ where: { jobId } }),
          prisma.workflowRun.findUnique({ where: { id: fixture.run.id } }),
          prisma.workflowNodeRun.findUnique({ where: { id: fixture.nodeRun.id } })
        ]);
        return (
          job?.status === "failed" &&
          workflowRun?.status === "failed" &&
          workflowNodeRun?.status === "failed"
        );
      }, "Denied Desktop Job did not fail.", 20_000);

      const persistedJob = await prisma.desktopJob.findUnique({
        where: { jobId },
        include: { events: { orderBy: { sequence: "asc" } } }
      });
      const persistedNode = await prisma.workflowNodeRun.findUnique({
        where: { id: fixture.nodeRun.id }
      });
      expect(persistedJob.events.map((event: { type: string }) => event.type)).toEqual([
        "job.accepted",
        "job.started",
        "approval.requested",
        "approval.resolved",
        "job.failed"
      ]);
      expect(persistedJob.error).toMatchObject({
        code: "TOOL_APPROVAL_DENIED"
      });
      expect(persistedNode.error).toMatchObject({
        code: "TOOL_APPROVAL_DENIED"
      });
    } catch (error) {
      const diagnostics = await collectDiagnostics({
        prisma,
        worker,
        client,
        coreProcess,
        runId: fixture.run.id,
        nodeRunId: fixture.nodeRun.id,
        jobId: created?.jobId ?? "not-created"
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(diagnostics, null, 2)}`
      );
    } finally {
      control.resolveDecision("denied");
      control.release.resolve();
      approvalJobControl = null;
    }
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
  const mainPath = resolveCoreMainPath(root);
  if (!existsSync(mainPath)) {
    throw new Error(`Built RouteMarket Core was not found at ${mainPath}.`);
  }
  return root;
}

function resolveCoreMainPath(root: string) {
  return resolve(
    root,
    "apps",
    "core-api",
    "dist",
    "apps",
    "core-api",
    "src",
    "main.js"
  );
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
  const mainPath = resolveCoreMainPath(root);
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
  registry: ProjectRegistry,
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
    projectContext: (localProjectId) => loadProjectContext(registry, localProjectId),
    inspectProjectSkill: (localProjectId, skillId) =>
      inspectProjectSkillPackage(registry, localProjectId, skillId),
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

async function executeControlledExternalJob(
  runtime: CloudJobRuntime,
  registry: ProjectRegistry,
  control: ExternalJobControl | null,
  approvalControl: ApprovalJobControl | null,
  job: DesktopJob,
  leaseId: string,
  leaseEpoch: number,
  signal: AbortSignal,
  emitEvents: (events: JobEvent[]) => Promise<void>
): Promise<JobEvent[]> {
  const began = runtime.beginExternalJob({ job, leaseId, leaseEpoch });
  if (!began.execute) return began.events;
  await emitEvents(began.events);
  if (approvalControl) {
    const approvalId = `approval_${job.jobId}`;
    await emitEvents(runtime.recordExternalApproval({
      job,
      leaseId,
      leaseEpoch,
      eventType: "approval.requested",
      data: {
        approvalId,
        capability: job.executorKey,
        risk: job.approvalPolicy.risk
      }
    }));
    approvalControl.requested.resolve();
    const decision = await approvalControl.decision;
    await emitEvents(runtime.recordExternalApproval({
      job,
      leaseId,
      leaseEpoch,
      eventType: "approval.resolved",
      data: {
        approvalId,
        capability: job.executorKey,
        risk: job.approvalPolicy.risk,
        decision
      }
    }));
    approvalControl.resolved.resolve();
    await approvalControl.release.promise;
    if (decision === "denied") {
      return runtime.failExternalJob({
        job,
        leaseId,
        leaseEpoch,
        failure: {
          code: "TOOL_APPROVAL_DENIED",
          message: "The local tool request was denied."
        }
      });
    }
    if (job.executorKey === "local.skill.invoke") {
      const result = await executeLocalSkillInvoke(registry, job);
      return runtime.completeExternalJob({
        job,
        leaseId,
        leaseEpoch,
        result
      });
    }
    const outputUrl =
      "url" in job.input && typeof job.input.url === "string"
        ? job.input.url
        : "";
    return runtime.completeExternalJob({
      job,
      leaseId,
      leaseEpoch,
      result: {
        text: `Opened ${outputUrl}`,
        url: outputUrl
      }
    });
  }
  if (!control) {
    return runtime.failExternalJob({
      job,
      leaseId,
      leaseEpoch,
      failure: {
        code: "E2E_EXTERNAL_EXECUTOR_UNAVAILABLE",
        message: "The real Core E2E external executor was not armed."
      }
    });
  }
  control.started.resolve();
  await new Promise<void>((resolveAbort) => {
    const onAbort = () => {
      control.aborted.resolve();
      resolveAbort();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  await control.release.promise;
  return runtime.failExternalJob({
    job,
    leaseId,
    leaseEpoch,
    failure: {
      code: "TOOL_CANCELED",
      message: "Desktop Job was canceled by the real Core E2E."
    }
  });
}

function createE2ESkillSigner(): {
  signer: CloudSkillSigner;
  keyId: string;
  current: () => ProjectSkillPackageIdentity;
} {
  const pair = generateKeyPairSync("ed25519");
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const publicKey = publicDer.subarray(-32).toString("base64");
  const keyId = `device_${createHash("sha256").update(publicKey).digest("hex").slice(0, 24)}`;
  let latest: ProjectSkillPackageIdentity | null = null;
  const authorized = new Map<string, {
    version: string;
    packageDigest: string;
    operations: string[];
  }>();
  const signer: CloudSkillSigner = {
    async signManifest(identities) {
      latest = identities[0] ?? null;
      authorized.clear();
      const localSkills = identities.map((identity) => {
        authorized.set(`${identity.projectBindingId}:${identity.skillId}`, {
          version: identity.version,
          packageDigest: identity.packageDigest,
          operations: identity.operations
        });
        return {
          skillId: identity.skillId,
          version: identity.version,
          packageDigest: identity.packageDigest,
          signingKeyId: keyId,
          signature: sign(
            null,
            Buffer.from(localSkillSigningPayload(identity)),
            pair.privateKey
          ).toString("base64"),
          projectBindingId: identity.projectBindingId,
          permissions: identity.permissions,
          operations: identity.operations
        };
      });
      return {
        signingKeys: localSkills.length
          ? [{ keyId, algorithm: "ed25519", publicKey, trust: "device" }]
          : [],
        localSkills
      };
    },
    assertAuthorizedJob(job) {
      const identity = authorized.get(`${job.projectBindingId}:${job.input.skillId}`);
      if (
        !identity ||
        identity.version !== job.input.version ||
        identity.packageDigest !== job.input.packageDigest ||
        !identity.operations.includes(job.input.operation)
      ) {
        throw new Error("The local Skill job does not match the signed E2E manifest.");
      }
      return identity;
    }
  };
  return {
    signer,
    keyId,
    current: () => {
      if (!latest) throw new Error("The E2E local Skill was not advertised.");
      return latest;
    }
  };
}

function localSkillSigningPayload(input: ProjectSkillPackageIdentity): string {
  return JSON.stringify({
    skillId: input.skillId,
    version: input.version,
    packageDigest: input.packageDigest,
    projectBindingId: input.projectBindingId,
    permissions: [...input.permissions].sort(),
    operations: [...input.operations].sort()
  });
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

function deferred(): Deferred {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createApprovalJobControl(): ApprovalJobControl {
  let resolveDecision!: (decision: ApprovalDecision) => void;
  const decision = new Promise<ApprovalDecision>((resolvePromise) => {
    resolveDecision = resolvePromise;
  });
  return {
    requested: deferred(),
    resolved: deferred(),
    release: deferred(),
    decision,
    resolveDecision
  };
}

async function createApprovalWorkflowFixture(input: {
  prisma: PrismaClientLike;
  userId: string;
  runtimeId: string;
  bindingId: string;
  suffix: string;
  url: string;
}) {
  const nodeId = `desktop_browser_${input.suffix}`;
  const graphSnapshot = {
    nodes: [
      {
        id: nodeId,
        title: `Open ${input.suffix} fixture`,
        nodeType: "desktop.local_browser_navigate",
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
        runtime: { executorKey: "local.browser.navigate" },
        channelGroupBindings: {},
        desktopRuntimeId: input.runtimeId,
        desktopProjectBindingId: input.bindingId,
        desktopUrl: input.url
      }
    ],
    edges: []
  };
  const run = await input.prisma.workflowRun.create({
    data: {
      userId: input.userId,
      status: "waiting_desktop",
      graphSnapshot
    }
  });
  const nodeRun = await input.prisma.workflowNodeRun.create({
    data: {
      runId: run.id,
      nodeId,
      executorKey: "local.browser.navigate",
      executorFamily: "desktop",
      stage: 1,
      status: "waiting_desktop",
      attempts: 0
    }
  });
  return {
    run,
    nodeRun,
    jobBody: {
      runtime_id: input.runtimeId,
      project_binding_id: input.bindingId,
      workflow_run_id: run.id,
      workflow_node_run_id: nodeRun.id,
      executor_key: "local.browser.navigate",
      executor_version: 1,
      input: { url: input.url },
      required_capabilities: ["local.browser.navigate"],
      execution_class: "external_side_effect",
      approval_policy: { risk: "R1", mode: "invocation" },
      idempotency_key: `sha256:${createHash("sha256")
        .update(`core-e2e-approval-${input.suffix}:${run.id}`)
        .digest("hex")}`,
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
      max_inline_result_bytes: 262_144
    }
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
