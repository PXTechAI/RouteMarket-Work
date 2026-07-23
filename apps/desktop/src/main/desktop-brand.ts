import { join } from "node:path";

export const DESKTOP_APP_ID = "ai.routemarket.work";

export function desktopWindowIconPath(mainDirectory: string): string {
  return join(mainDirectory, "../../build/icon.png");
}
