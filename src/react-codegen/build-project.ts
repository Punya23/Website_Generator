import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = Number(process.env.REACT_BUILD_TIMEOUT_MS ?? 300_000);
const CACHE_ROOT = path.resolve("output", ".react-build-cache");

async function packageHash(projectPath: string): Promise<string> {
  const pkg = await fs.readFile(path.join(projectPath, "package.json"), "utf8");
  return crypto.createHash("sha256").update(pkg).digest("hex").slice(0, 16);
}

async function copyNodeModules(from: string, to: string): Promise<void> {
  await fs.cp(from, to, { recursive: true, force: true });
}

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
  const hash = await packageHash(projectPath);
  const cacheDir = path.join(CACHE_ROOT, hash);
  const cachedModules = path.join(cacheDir, "node_modules");
  const projectModules = path.join(projectPath, "node_modules");

  let modulesReady = false;
  try {
    await fs.access(cachedModules);
    await copyNodeModules(cachedModules, projectModules);
    modulesReady = true;
  } catch {
    // cold cache
  }

  if (!modulesReady) {
    // The platform SWC binary is now a regular dependency of the generated package.json
    // (see platformSwcDependency in assemble-project.ts), so a plain install fetches it — no
    // separate --save-optional patch step (which also mutated package.json mid-build).
    await runCommand("npm install", projectPath, timeoutMs);
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await copyNodeModules(projectModules, cachedModules);
    } catch {
      // cache write is best-effort
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await runCommand("npm run build", projectPath, timeoutMs);
      return path.join(projectPath, "out");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await runCommand("npm install", projectPath, timeoutMs);
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
