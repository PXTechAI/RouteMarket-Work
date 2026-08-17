import { tr } from "../../i18n";
import type { ProjectSummary } from "../../../../shared/desktop-api";
export type ProjectFolderStatus = NonNullable<ProjectSummary["folderStatus"]>;
export function projectFolderStatus(project: ProjectSummary | null | undefined): ProjectFolderStatus {
    if (!project)
        return "unlinked";
    return project.folderStatus ?? (project.hasFolder === false ? "unlinked" : "available");
}
export function projectFolderAvailable(project: ProjectSummary | null | undefined): boolean {
    return projectFolderStatus(project) === "available";
}
export function projectFolderLabel(project: ProjectSummary | null | undefined): string {
    const status = projectFolderStatus(project);
    if (status === "available")
        return tr("ui.8b4c1c5f0c40");
    if (status === "missing")
        return tr("ui.2c7508b4cf7d");
    if (status === "unavailable")
        return tr("ui.7885f7e9528d");
    return tr("ui.ed5e011db4c0");
}
export function projectFolderMessage(project: ProjectSummary | null | undefined): string {
    const status = projectFolderStatus(project);
    if (status === "available")
        return tr("ui.affc9d1f064a");
    if (status === "missing")
        return tr("ui.6ff15991a659");
    if (status === "unavailable")
        return tr("ui.a94bcf456ce6");
    return tr("ui.d59f089e0255");
}
