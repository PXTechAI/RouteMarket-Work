import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_APP_ID, desktopWindowIconPath } from "./desktop-brand";

const desktopRoot = resolve(__dirname, "../..");

describe("desktop brand assets", () => {
  it("keeps the runtime icon path aligned with the packaged asset", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(desktopRoot, "package.json"), "utf8")
    ) as {
      build: {
        appId: string;
        files: string[];
        mac: { icon: string };
        win: { icon: string };
      };
    };

    expect(DESKTOP_APP_ID).toBe(packageJson.build.appId);
    expect(packageJson.build.files).toContain("build/icon.png");
    expect(packageJson.build.win.icon).toBe("build/icon.png");
    expect(packageJson.build.mac.icon).toBe("build/icon.png");
    expect(desktopWindowIconPath(resolve(desktopRoot, "out/main"))).toBe(
      resolve(desktopRoot, "build/icon.png")
    );
  });

  it("ships a square, high-resolution PNG icon", async () => {
    const icon = await readFile(resolve(desktopRoot, "build/icon.png"));

    expect([...icon.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const width = icon.readUInt32BE(16);
    const height = icon.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(256);
  });
});
