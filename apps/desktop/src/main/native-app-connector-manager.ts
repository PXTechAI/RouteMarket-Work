import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type {
  NativeAppConnectorId,
  NativeAppConnectorSummary,
  NativeAppOpenResult
} from "../shared/desktop-api";

type ConnectorDefinition = Omit<NativeAppConnectorSummary, "available">;

export class NativeAppConnectorManager {
  private readonly definitions: ConnectorDefinition[];

  constructor(
    definitions = discoverNativeAppConnectors(),
    private readonly launch: (executable: string, args: string[]) => void = launchDetached
  ) {
    this.definitions = definitions;
  }

  list(): NativeAppConnectorSummary[] {
    return this.definitions.map((connector) => ({
      ...connector,
      available: Boolean(connector.executablePath && existsSync(connector.executablePath))
    }));
  }

  async open(
    connectorId: NativeAppConnectorId,
    projectRoot: string,
    relativePath?: string
  ): Promise<NativeAppOpenResult> {
    const connector = this.list().find((item) => item.connectorId === connectorId);
    if (!connector) throw new Error("Unknown native app connector.");
    if (!connector.available || !connector.executablePath) {
      throw new Error(`${connector.name} is not installed or could not be detected.`);
    }
    const openedPath = await resolveProjectTarget(projectRoot, relativePath ?? ".");
    const targetStat = await stat(openedPath);
    if (connectorId !== "vscode") {
      if (!targetStat.isFile()) throw new Error(`${connector.name} requires a project file.`);
      const extension = extname(openedPath).toLocaleLowerCase();
      if (!connector.supportedExtensions.includes(extension)) {
        throw new Error(`${connector.name} does not support ${extension || "this file type"}.`);
      }
    }
    this.launch(connector.executablePath, [openedPath]);
    return { connectorId, openedPath, launchedAt: new Date().toISOString() };
  }
}

export function discoverNativeAppConnectors(
  environment: NodeJS.ProcessEnv = process.env
): ConnectorDefinition[] {
  const local = environment.LOCALAPPDATA ?? "";
  const programFiles = environment.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = environment["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return [
    {
      connectorId: "vscode",
      name: "Visual Studio Code",
      description: "在 VS Code 中打开当前项目或项目内文件。",
      executablePath: firstExisting([
        resolve(local, "Programs/Microsoft VS Code/Code.exe"),
        resolve(programFiles, "Microsoft VS Code/Code.exe"),
        resolve(programFilesX86, "Microsoft VS Code/Code.exe")
      ]),
      supportedExtensions: []
    },
    {
      connectorId: "excel",
      name: "Microsoft Excel",
      description: "在本机 Excel 中打开项目内工作簿。",
      executablePath: firstExisting(officeCandidates("EXCEL.EXE", programFiles, programFilesX86)),
      supportedExtensions: [".xlsx", ".xls", ".xlsm", ".csv"]
    },
    {
      connectorId: "powerpoint",
      name: "Microsoft PowerPoint",
      description: "在本机 PowerPoint 中打开项目内演示文稿。",
      executablePath: firstExisting(officeCandidates("POWERPNT.EXE", programFiles, programFilesX86)),
      supportedExtensions: [".pptx", ".ppt", ".pptm"]
    }
  ];
}

async function resolveProjectTarget(projectRoot: string, relativePath: string): Promise<string> {
  if (isAbsolute(relativePath) || relativePath.replaceAll("\\", "/").split("/").includes("..")) {
    throw new Error("Native app target must stay inside the project.");
  }
  const root = await realpath(projectRoot);
  const target = await realpath(resolve(root, relativePath));
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Native app target escapes the project root.");
  }
  return target;
}

function officeCandidates(executable: string, programFiles: string, programFilesX86: string): string[] {
  return [programFiles, programFilesX86].flatMap((root) => [
    resolve(root, `Microsoft Office/root/Office16/${executable}`),
    resolve(root, `Microsoft Office/Office16/${executable}`),
    resolve(root, `Microsoft Office/Office15/${executable}`)
  ]);
}

function firstExisting(paths: string[]): string | null {
  return paths.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function launchDetached(executable: string, args: string[]): void {
  const child = spawn(executable, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}
