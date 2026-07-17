export type ProjectSummary = {
  localProjectId: string;
  displayName: string;
  rootFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export type ReadResult = {
  uri: string;
  text: string;
  bytesRead: number;
  truncated: boolean;
  encoding: "utf8";
};

export type ProjectFileEntry = {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  children?: ProjectFileEntry[];
};

export type ProjectFileTree = {
  entries: ProjectFileEntry[];
  totalEntries: number;
  truncated: boolean;
};

export type ActivityItem = {
  id: string;
  kind:
    | "project.bound"
    | "cloud.connected"
    | "cloud.error"
    | "job.offered"
    | "job.started"
    | "job.succeeded"
    | "job.failed";
  title: string;
  detail: string;
  occurredAt: string;
};

export type CloudWorkerStatus = "disabled" | "connecting" | "online" | "error";

export type WorkState = {
  workerStatus: "starting" | "online" | "offline";
  cloudStatus: CloudWorkerStatus;
  runtimeId: string | null;
  cloudError: string | null;
  authStatus: "signed_out" | "authorizing" | "signed_in" | "error";
  account?: {
    id: string;
    displayName: string;
    email: string | null;
  };
  authError: string | null;
  projects: ProjectSummary[];
  activities: ActivityItem[];
};

export type RouteMarketWorkApi = {
  getState(): Promise<WorkState>;
  signIn(): Promise<WorkState>;
  signOut(): Promise<WorkState>;
  chooseProject(): Promise<ProjectSummary | null>;
  listProjectFiles(localProjectId: string): Promise<ProjectFileTree>;
  readProjectFile(localProjectId: string, relativePath: string): Promise<ReadResult>;
};
