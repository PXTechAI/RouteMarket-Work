import { createHash } from "node:crypto";

export function projectBindingIdFor(localProjectId: string): string {
  return `binding_${createHash("sha256").update(localProjectId).digest("hex").slice(0, 32)}`;
}
