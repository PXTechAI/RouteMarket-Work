import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DesktopPreferences } from "../shared/desktop-api";

export class DesktopPreferenceStore {
  private preferences: DesktopPreferences = {};
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!raw) return;
    try {
      this.preferences = sanitizePreferences(JSON.parse(raw));
    } catch {
      this.preferences = {};
    }
  }

  get(): DesktopPreferences {
    return structuredClone(this.preferences);
  }

  update(patch: DesktopPreferences): Promise<DesktopPreferences> {
    const operation = async () => {
      this.preferences = sanitizePreferences({ ...this.preferences, ...patch });
      await this.persist();
    };
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result;
    return result.then(() => this.get());
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.preferences, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}

export function sanitizePreferences(value: unknown): DesktopPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: DesktopPreferences = {};
  if (
    input.locale === "system" || input.locale === "en-US" || input.locale === "zh-CN" ||
    input.locale === "ja-JP" || input.locale === "es-ES" || input.locale === "pt-BR" ||
    input.locale === "th-TH" || input.locale === "ko-KR"
  ) {
    output.locale = input.locale;
  }
  if (input.theme === "system" || input.theme === "light" || input.theme === "dark") {
    output.theme = input.theme;
  }
  if (typeof input.zoomFactor === "number" && Number.isFinite(input.zoomFactor)) {
    output.zoomFactor = Math.round(Math.min(3, Math.max(0.5, input.zoomFactor)) * 100) / 100;
  }
  if (typeof input.railExpanded === "boolean") output.railExpanded = input.railExpanded;
  if (input.projectModels && typeof input.projectModels === "object" && !Array.isArray(input.projectModels)) {
    output.projectModels = Object.fromEntries(
      Object.entries(input.projectModels as Record<string, unknown>)
        .filter((entry): entry is [string, string] =>
          entry[0].length > 0 && entry[0].length <= 200 &&
          typeof entry[1] === "string" && entry[1].length > 0 && entry[1].length <= 200
        )
        .slice(-100)
    );
  }
  return output;
}
