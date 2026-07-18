import { open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { WorkerError } from "./errors";
import { ProjectRegistry } from "./project-registry";
import { resolveProjectFile } from "./project-uri";

const MAX_CONTEXT_FILE_BYTES = 64 * 1024;
const MAX_SKILLS = 100;

export type ProjectTextContext = {
  relativePath: string;
  text: string;
  truncated: boolean;
};

export type ProjectSettings = {
  defaultAgent: string | null;
  defaultModel: string | null;
  cloudProjectId: string | null;
  ignore: string[];
};

export type ProjectSkillSummary = {
  id: string;
  name: string;
  description: string;
  relativePath: string;
};

export type ProjectContext = {
  instructions: ProjectTextContext | null;
  readme: ProjectTextContext | null;
  settings: ProjectSettings;
  skills: ProjectSkillSummary[];
};

export async function loadProjectContext(
  registry: ProjectRegistry,
  localProjectId: string
): Promise<ProjectContext> {
  const project = registry.get(localProjectId);
  if (!project) throw new WorkerError("PROJECT_NOT_BOUND", "Project is not bound on this device.");

  const rootNames = await listFileNames(project.realRootPath);
  const agentsName = findCaseInsensitive(rootNames, "AGENTS.md");
  const readmeName = findCaseInsensitive(rootNames, "README.md");
  const [instructions, readme, settings, skills] = await Promise.all([
    agentsName ? readContextFile(project, agentsName) : null,
    readmeName ? readContextFile(project, readmeName) : null,
    readProjectSettings(project),
    discoverProjectSkills(project)
  ]);
  return { instructions, readme, settings, skills };
}

async function readProjectSettings(project: Parameters<typeof resolveProjectFile>[0]) {
  const relativePath = ".routemarket/project.json";
  const text = await readOptionalText(project, relativePath, MAX_CONTEXT_FILE_BYTES);
  if (text === null) return emptySettings();
  let value: unknown;
  try {
    value = JSON.parse(text.text);
  } catch {
    throw new WorkerError("PROJECT_SETTINGS_INVALID", ".routemarket/project.json is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerError("PROJECT_SETTINGS_INVALID", "Project settings must be a JSON object.");
  }
  const settings = value as Record<string, unknown>;
  return {
    defaultAgent: optionalString(settings.defaultAgent, "defaultAgent"),
    defaultModel: optionalString(settings.defaultModel, "defaultModel"),
    cloudProjectId: optionalString(settings.cloudProjectId, "cloudProjectId"),
    ignore: stringArray(settings.ignore, "ignore")
  } satisfies ProjectSettings;
}

async function discoverProjectSkills(
  project: Parameters<typeof resolveProjectFile>[0]
): Promise<ProjectSkillSummary[]> {
  const root = await resolveProjectFile(project, ".routemarket/skills").catch((error) => {
    if (error instanceof WorkerError && error.code === "PROJECT_FILE_NOT_FOUND") return null;
    throw error;
  });
  if (!root) return [];
  const entries = await opendir(root).catch(() => null);
  if (!entries) return [];
  const skills: ProjectSkillSummary[] = [];
  for await (const entry of entries) {
    if (skills.length >= MAX_SKILLS) break;
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const relativePath = `.routemarket/skills/${entry.name}/SKILL.md`;
    const content = await readOptionalText(project, relativePath, MAX_CONTEXT_FILE_BYTES);
    if (!content) continue;
    const metadata = parseSkillMetadata(content.text, entry.name);
    skills.push({
      id: entry.name,
      name: metadata.name,
      description: metadata.description,
      relativePath
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function readContextFile(
  project: Parameters<typeof resolveProjectFile>[0],
  relativePath: string
): Promise<ProjectTextContext> {
  const content = await readOptionalText(project, relativePath, MAX_CONTEXT_FILE_BYTES);
  if (!content) throw new WorkerError("PROJECT_FILE_NOT_FOUND", `${relativePath} no longer exists.`);
  return { relativePath, ...content };
}

async function readOptionalText(
  project: Parameters<typeof resolveProjectFile>[0],
  relativePath: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean } | null> {
  const filePath = await resolveProjectFile(project, relativePath).catch((error) => {
    if (error instanceof WorkerError && error.code === "PROJECT_FILE_NOT_FOUND") return null;
    throw error;
  });
  if (!filePath) return null;
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, bytesRead).includes(0)) {
      throw new WorkerError("PROJECT_CONTEXT_BINARY", `${relativePath} is not a text file.`);
    }
    const truncated = bytesRead > maxBytes;
    return {
      text: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString("utf8"),
      truncated
    };
  } finally {
    await handle.close();
  }
}

async function listFileNames(root: string): Promise<string[]> {
  const directory = await opendir(root);
  const names: string[] = [];
  for await (const entry of directory) {
    if (entry.isFile() && !entry.isSymbolicLink()) names.push(entry.name);
  }
  return names;
}

function findCaseInsensitive(values: string[], target: string): string | undefined {
  const normalized = target.toLocaleLowerCase();
  return values.find((value) => value.toLocaleLowerCase() === normalized);
}

function emptySettings(): ProjectSettings {
  return { defaultAgent: null, defaultModel: null, cloudProjectId: null, ignore: [] };
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 256 || value.includes("\0")) {
    throw new WorkerError("PROJECT_SETTINGS_INVALID", `${field} must be a short string.`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500 || value.some((item) =>
    typeof item !== "string" || item.length > 512 || item.includes("\0")
  )) {
    throw new WorkerError("PROJECT_SETTINGS_INVALID", `${field} must be an array of path patterns.`);
  }
  return [...new Set(value as string[])];
}

function parseSkillMetadata(text: string, fallbackName: string) {
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const source = frontmatter?.[1] ?? "";
  const name = source.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ||
    text.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackName;
  const description = source.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ||
    text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#") && line !== "---")?.trim() ||
    "";
  return { name: name.slice(0, 128), description: description.slice(0, 512) };
}
