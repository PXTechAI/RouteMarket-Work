import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeAppConnectorManager } from "./native-app-connector-manager";

describe("NativeAppConnectorManager", () => {
  let directory: string;
  let executable: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "routemarket-connector-"));
    // A fake .exe can be held by Windows antivirus long enough to make
    // recursive test cleanup time out. The manager only requires an existing
    // executable path here, so use a neutral stub extension.
    executable = join(directory, "app.stub");
    await writeFile(executable, "stub");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("opens a supported project file with the selected connector", async () => {
    const launch = vi.fn();
    const manager = new NativeAppConnectorManager(
      [
        {
          connectorId: "excel",
          name: "Excel",
          description: "test",
          executablePath: executable,
          supportedExtensions: [".rmwtest"],
        },
      ],
      launch,
    );
    await mkdir(join(directory, "docs"));
    await writeFile(join(directory, "docs", "report.rmwtest"), "data");
    const result = await manager.open("excel", directory, "docs/report.rmwtest");
    expect(result.openedPath).toBe(await realpath(join(directory, "docs", "report.rmwtest")));
    expect(launch).toHaveBeenCalledWith(executable, [result.openedPath]);
  });

  it("rejects targets outside the project and unsupported extensions", async () => {
    const manager = new NativeAppConnectorManager(
      [
        {
          connectorId: "powerpoint",
          name: "PowerPoint",
          description: "test",
          executablePath: executable,
          supportedExtensions: [".pptx"],
        },
      ],
      vi.fn(),
    );
    await writeFile(join(directory, "notes.txt"), "data");
    await expect(manager.open("powerpoint", directory, "../outside.pptx")).rejects.toThrow("inside the project");
    await expect(manager.open("powerpoint", directory, "notes.txt")).rejects.toThrow("does not support");
  });

  it("reports a connector unavailable when its executable is missing", () => {
    const manager = new NativeAppConnectorManager(
      [
        {
          connectorId: "vscode",
          name: "VS Code",
          description: "test",
          executablePath: join(directory, "missing.exe"),
          supportedExtensions: [],
        },
      ],
      vi.fn(),
    );
    expect(manager.list()[0]?.available).toBe(false);
  });
});
