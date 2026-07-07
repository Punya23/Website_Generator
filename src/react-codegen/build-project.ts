import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = Number(process.env.REACT_BUILD_TIMEOUT_MS ?? 300_000);

export interface BuildProjectOptions {
  timeoutMs?: number;
  retries?: number;
}

export async function buildReactProject(
  projectPath: string,
  options: BuildProjectOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.retries ?? 2;

  // Always install in the target project directory. Copying node_modules from another
  // generated site breaks Next builds: npm's .bin symlinks are absolute paths, so React/Next
  // resolve from the wrong project and prerender fails with "useContext" null.
  await runCommand("npm install --prefer-offline --no-audit --no-fund", projectPath, timeoutMs);
  await fs.rm(path.join(projectPath, ".next"), { recursive: true, force: true }).catch(() => undefined);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await runCommand("npm run build", projectPath, timeoutMs);
      return path.join(projectPath, "out");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await runCommand("npm install --prefer-offline --no-audit --no-fund", projectPath, timeoutMs);
        await fs.rm(path.join(projectPath, ".next"), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  throw lastError ?? new Error("React build failed");
}

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<void> {
  try {
    await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const detail =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: Buffer }).stderr ?? "")
        : "";
    throw new Error(detail || (err instanceof Error ? err.message : String(err)));
  }
}
