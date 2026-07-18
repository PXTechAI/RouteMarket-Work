import { existsSync } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_UPLOAD_FILES = 20;
const MAX_FILE_NAME_LENGTH = 180;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export async function prepareProjectDownloadDirectory(projectRoot: string): Promise<string> {
  const root = await realpath(projectRoot);
  const directory = join(root, ".routemarket", "downloads");
  await mkdir(directory, { recursive: true });
  return directory;
}

export function allocateDownloadPath(
  directory: string,
  suggestedFileName: string,
  reservedFileNames: ReadonlySet<string> = new Set()
): { fileName: string; absolutePath: string } {
  const reserved = new Set(
    [...reservedFileNames].map((fileName) => fileName.toLocaleLowerCase("en-US"))
  );
  const safeName = sanitizeDownloadFileName(suggestedFileName);
  let absolutePath = join(directory, safeName);
  if (!existsSync(absolutePath) && !reserved.has(safeName.toLocaleLowerCase("en-US"))) {
    return { fileName: safeName, absolutePath };
  }

  const extension = extname(safeName);
  const stem = basename(safeName, extension);
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    absolutePath = join(directory, candidate);
    if (!existsSync(absolutePath) && !reserved.has(candidate.toLocaleLowerCase("en-US"))) {
      return { fileName: candidate, absolutePath };
    }
  }
  throw new Error("Unable to allocate a unique Browser download path.");
}

export function sanitizeDownloadFileName(value: string): string {
  const leaf = basename(value.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  const usable = !leaf || leaf === "." || leaf === ".." || WINDOWS_RESERVED_NAME.test(leaf)
    ? `download-${Date.now()}`
    : leaf;
  if (usable.length <= MAX_FILE_NAME_LENGTH) return usable;
  const extension = extname(usable).slice(0, 24);
  return `${basename(usable, extension).slice(0, MAX_FILE_NAME_LENGTH - extension.length)}${extension}`;
}

export async function resolveProjectUploadFiles(
  projectRoot: string,
  relativePaths: string[]
): Promise<{ absolutePaths: string[]; relativePaths: string[] }> {
  if (!relativePaths.length || relativePaths.length > MAX_UPLOAD_FILES) {
    throw new Error(`Browser upload requires between 1 and ${MAX_UPLOAD_FILES} project files.`);
  }
  const root = await realpath(projectRoot);
  const resolved = await Promise.all(relativePaths.map(async (input) => {
    const normalized = input.trim().replaceAll("\\", "/");
    if (
      !normalized ||
      isAbsolute(input) ||
      normalized.split("/").some((segment) => segment === "..")
    ) {
      throw new Error("Browser upload files must use project-relative paths.");
    }
    const absolutePath = await realpath(resolve(root, normalized));
    assertWithinRoot(root, absolutePath);
    if (!(await stat(absolutePath)).isFile()) {
      throw new Error("Browser upload only supports project files.");
    }
    return {
      absolutePath,
      relativePath: relative(root, absolutePath).split(sep).join("/")
    };
  }));
  return {
    absolutePaths: resolved.map((item) => item.absolutePath),
    relativePaths: resolved.map((item) => item.relativePath)
  };
}

function assertWithinRoot(rootPath: string, candidatePath: string): void {
  const fromRoot = relative(rootPath, candidatePath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Browser upload file escapes the project root.");
  }
}
