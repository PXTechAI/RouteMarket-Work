import { tr } from "../i18n";
export type BuildEnvironment = {
    label: string;
    kind: "development" | "local-package";
};
export function resolveBuildEnvironment(mode: string, isDevelopment: boolean): BuildEnvironment | null {
    if (isDevelopment || mode === "development") {
        return { label: tr("ui.6f9b7302c692"), kind: "development" };
    }
    if (mode === "desktop-local") {
        return { label: tr("ui.21ed9bc385f2"), kind: "local-package" };
    }
    return null;
}
