export type BuildEnvironment = {
  label: string;
  kind: "development" | "local-package";
};

export function resolveBuildEnvironment(mode: string, isDevelopment: boolean): BuildEnvironment | null {
  if (isDevelopment || mode === "development") {
    return { label: "开发版", kind: "development" };
  }
  if (mode === "desktop-local") {
    return { label: "本地测试包", kind: "local-package" };
  }
  return null;
}
