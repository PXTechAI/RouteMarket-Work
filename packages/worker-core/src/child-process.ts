import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const TASKKILL_TIMEOUT_MS = 1_000;
const activeTerminations = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>();

export function terminateProcessTree(
  child: ChildProcessWithoutNullStreams
): Promise<void> {
  const active = activeTerminations.get(child);
  if (active) return active;
  const termination = terminateProcessTreeOnce(child).finally(() => {
    if (activeTerminations.get(child) === termination) activeTerminations.delete(child);
  });
  activeTerminations.set(child, termination);
  return termination;
}

async function terminateProcessTreeOnce(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (hasExited(child)) return;

  const exitPromise = waitForExit(child);
  const pid = child.pid;

  if (process.platform === "win32" && pid) {
    // Terminate the direct child immediately. `taskkill /t` remains necessary
    // for descendants, but it can fail to start under Windows resource
    // pressure; relying on it alone leaves the project cwd locked.
    child.kill("SIGKILL");
    await runTaskkill(pid, child);
  } else {
    try {
      if (pid) process.kill(-pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  await exitPromise;
}

function runTaskkill(pid: number, child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore"
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      killer.kill();
      if (!hasExited(child)) child.kill("SIGKILL");
      finish();
    }, TASKKILL_TIMEOUT_MS);
    timer.unref();
    killer.once("exit", (code) => {
      if (code !== 0 && !hasExited(child)) child.kill("SIGKILL");
      finish();
    });
    killer.once("error", () => {
      child.kill();
      finish();
    });
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, PROCESS_EXIT_TIMEOUT_MS);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
    // Another cleanup call may have observed the exit between the initial
    // check and listener registration.
    if (hasExited(child)) {
      clearTimeout(timer);
      resolve();
    }
  });
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
