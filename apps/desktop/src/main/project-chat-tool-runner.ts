import { createHash } from "node:crypto";
import type {
  ProjectFileEntry,
  ProjectSearchMatch,
  ReadResult
} from "../shared/desktop-api";
import type { LocalToolBroker } from "./tool-broker";
import type { WorkerClient } from "./worker-client";
import type {
  ProjectChatToolCall,
  ProjectChatToolExecution
} from "./project-chat-tools";

const MAX_PATH_LENGTH = 1_024;
const MAX_WRITE_CHARACTERS = 1_000_000;
const MAX_TOOL_TEXT_CHARACTERS = 160_000;
const MAX_LISTED_PATHS = 500;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

type ProjectChatToolRunnerOptions = {
  workerClient: Pick<
    WorkerClient,
    | "listProjectFiles"
    | "searchProject"
    | "readProjectFile"
    | "writeProjectFile"
    | "createProjectFile"
  >;
  toolBroker: LocalToolBroker;
  onActivity?: (
    type: "job.started" | "job.succeeded" | "job.failed",
    title: string,
    detail: string
  ) => void;
};

export class ProjectChatToolRunner {
  constructor(private readonly options: ProjectChatToolRunnerOptions) {}

  async execute(
    localProjectId: string,
    call: ProjectChatToolCall
  ): Promise<ProjectChatToolExecution> {
    try {
      const args = parseArguments(call.arguments);
      if (call.name === "project_list_files") {
        assertNoUnexpectedKeys(args, []);
        return await this.runRead(
          localProjectId,
          "查看项目文件",
          "项目文件树",
          async () => {
            const result = await this.options.workerClient.listProjectFiles(localProjectId);
            const paths = flattenEntries(result.entries).slice(0, MAX_LISTED_PATHS);
            return {
              content: stringifyToolResult({
                paths,
                total_entries: result.totalEntries,
                truncated: result.truncated || paths.length >= MAX_LISTED_PATHS
              }),
              summary: `${paths.length} 个路径`
            };
          }
        );
      }

      if (call.name === "project_search") {
        assertNoUnexpectedKeys(args, ["query"]);
        const query = requiredString(args, "query", 256);
        return await this.runRead(
          localProjectId,
          "搜索项目",
          query,
          async () => {
            const result = await this.options.workerClient.searchProject(
              localProjectId,
              query
            );
            return {
              content: stringifyToolResult({
                query: result.query,
                matches: result.matches.map(sanitizeSearchMatch),
                files_scanned: result.filesScanned,
                truncated: result.truncated
              }),
              summary: `${result.matches.length} 个结果`
            };
          }
        );
      }

      if (call.name === "project_read_file") {
        assertNoUnexpectedKeys(args, ["path"]);
        const path = requiredPath(args);
        return await this.runRead(
          localProjectId,
          "读取项目文件",
          path,
          async () => {
            const result = await this.options.workerClient.readProjectFile(
              localProjectId,
              path
            );
            return {
              content: stringifyToolResult(sanitizeReadResult(path, result)),
              summary: `${path} · ${result.bytesRead} bytes`
            };
          }
        );
      }

      if (call.name === "project_write_file") {
        assertNoUnexpectedKeys(args, ["path", "text", "expected_sha256"]);
        const path = requiredPath(args);
        const text = requiredText(args);
        const expectedSha256 = requiredString(args, "expected_sha256", 64);
        if (!SHA256_PATTERN.test(expectedSha256)) {
          throw new Error("expected_sha256 must be a 64-character SHA-256 hash.");
        }
        return await this.runMutation(
          localProjectId,
          {
            capability: "local.fs.write",
            title: `允许 AI 修改 ${path}？`,
            detail: path,
            approvalKey: `${expectedSha256}:${sha256(text)}`
          },
          "修改项目文件",
          path,
          async () => {
            const result = await this.options.workerClient.writeProjectFile(
              localProjectId,
              path,
              text,
              expectedSha256
            );
            return {
              content: stringifyToolResult({
                path,
                changed: result.changed,
                bytes_read: result.bytesRead,
                sha256: result.sha256,
                previous_sha256: result.previousSha256
              }),
              summary: result.changed ? `已修改 ${path}` : `${path} 没有变化`
            };
          }
        );
      }

      if (call.name === "project_create_file") {
        assertNoUnexpectedKeys(args, ["path", "text"]);
        const path = requiredPath(args);
        const text = requiredText(args);
        return await this.runMutation(
          localProjectId,
          {
            capability: "local.fs.create",
            title: `允许 AI 新建 ${path}？`,
            detail: path,
            approvalKey: `${path}:${sha256(text)}`
          },
          "新建项目文件",
          path,
          async () => {
            const result = await this.options.workerClient.createProjectFile(
              localProjectId,
              path,
              text
            );
            return {
              content: stringifyToolResult({
                path,
                created: true,
                bytes_read: result.bytesRead,
                sha256: result.sha256
              }),
              summary: `已创建 ${path}`
            };
          }
        );
      }

      throw new Error(`Unsupported local tool: ${call.name}`);
    } catch (error) {
      return {
        content: stringifyToolResult({
          error: {
            code: readErrorCode(error),
            message: error instanceof Error ? error.message : "Unknown local tool error"
          }
        }),
        summary: error instanceof Error ? error.message : "本地工具执行失败",
        isError: true
      };
    }
  }

  private async runRead(
    localProjectId: string,
    title: string,
    detail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
  ): Promise<ProjectChatToolExecution> {
    return this.runWithActivity(title, detail, () =>
      this.options.toolBroker.run(
        {
          capability: "local.fs.read",
          risk: "R0",
          title,
          detail,
          projectId: localProjectId
        },
        operation
      )
    );
  }

  private async runMutation(
    localProjectId: string,
    authorization: {
      capability: string;
      title: string;
      detail: string;
      approvalKey: string;
    },
    activityTitle: string,
    activityDetail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
  ): Promise<ProjectChatToolExecution> {
    return this.runWithActivity(activityTitle, activityDetail, () =>
      this.options.toolBroker.run(
        {
          ...authorization,
          risk: "R1",
          projectId: localProjectId
        },
        operation
      )
    );
  }

  private async runWithActivity(
    title: string,
    detail: string,
    operation: () => Promise<Omit<ProjectChatToolExecution, "isError">>
  ): Promise<ProjectChatToolExecution> {
    this.options.onActivity?.("job.started", title, detail);
    try {
      const result = await operation();
      this.options.onActivity?.("job.succeeded", title, result.summary);
      return { ...result, isError: false };
    } catch (error) {
      this.options.onActivity?.(
        "job.failed",
        title,
        error instanceof Error ? error.message : "Unknown local tool error"
      );
      throw error;
    }
  }
}

function parseArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function assertNoUnexpectedKeys(
  args: Record<string, unknown>,
  allowed: string[]
): void {
  const unexpected = Object.keys(args).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`Unexpected tool argument: ${unexpected}`);
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
  maxLength: number
): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${key} must contain between 1 and ${maxLength} characters.`);
  }
  if (value.includes("\0")) throw new Error(`${key} contains an invalid null byte.`);
  return value;
}

function requiredPath(args: Record<string, unknown>): string {
  return requiredString(args, "path", MAX_PATH_LENGTH).replaceAll("\\", "/");
}

function requiredText(args: Record<string, unknown>): string {
  const text = args.text;
  if (typeof text !== "string" || text.length > MAX_WRITE_CHARACTERS) {
    throw new Error(
      `text must be a string no longer than ${MAX_WRITE_CHARACTERS} characters.`
    );
  }
  return text;
}

function flattenEntries(
  entries: ProjectFileEntry[],
  output: Array<{ path: string; kind: "file" | "directory" }> = []
): Array<{ path: string; kind: "file" | "directory" }> {
  for (const entry of entries) {
    output.push({ path: entry.relativePath, kind: entry.kind });
    if (output.length >= MAX_LISTED_PATHS) return output;
    if (entry.children?.length) flattenEntries(entry.children, output);
    if (output.length >= MAX_LISTED_PATHS) return output;
  }
  return output;
}

function sanitizeSearchMatch(match: ProjectSearchMatch) {
  return {
    path: match.relativePath,
    match_kind: match.matchKind,
    line: match.line,
    column: match.column,
    preview: match.preview
  };
}

function sanitizeReadResult(path: string, result: ReadResult) {
  const clipped = clipText(result.text);
  return {
    path,
    text: clipped.text,
    bytes_read: result.bytesRead,
    truncated: result.truncated || clipped.truncated,
    encoding: result.encoding,
    sha256: result.sha256
  };
}

function clipText(text: string) {
  if (text.length <= MAX_TOOL_TEXT_CHARACTERS) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, MAX_TOOL_TEXT_CHARACTERS),
    truncated: true
  };
}

function stringifyToolResult(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "LOCAL_TOOL_ERROR";
}
