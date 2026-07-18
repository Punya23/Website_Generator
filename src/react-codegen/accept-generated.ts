/** Generated-project acceptance gate — typecheck then next build. */
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export interface AcceptResult {
  ok: boolean;
  error?: string;
  stage?: "typecheck" | "build";
}

function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 180_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32", env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 1, stdout, stderr: stderr + `\nTimed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Hard acceptance for an assembled Next project.
 * skipBuild=true runs only tsc (for fast fixture tests).
 */
export async function acceptGeneratedProject(
  projectPath: string,
  options?: { skipBuild?: boolean }
): Promise<AcceptResult> {
  const pkg = path.join(projectPath, "package.json");
  try {
    await fs.access(pkg);
  } catch {
    return { ok: false, stage: "typecheck", error: `No package.json at ${projectPath}` };
  }

  const nodeModules = path.join(projectPath, "node_modules");
  try {
    await fs.access(nodeModules);
  } catch {
    const install = await runCmd("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], projectPath);
    if (install.code !== 0) {
      return {
        ok: false,
        stage: "typecheck",
        error: `npm install failed: ${install.stderr.slice(0, 800)}`,
      };
    }
  }

  // Next projects typecheck via next build; optional standalone tsc if tsconfig exists.
  const tsconfig = path.join(projectPath, "tsconfig.json");
  try {
    await fs.access(tsconfig);
    const tsc = await runCmd("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], projectPath, 120_000);
    if (tsc.code !== 0) {
      return {
        ok: false,
        stage: "typecheck",
        error: (tsc.stdout + "\n" + tsc.stderr).slice(0, 2000),
      };
    }
  } catch {
    // no tsconfig — rely on next build
  }

  if (options?.skipBuild) return { ok: true };

  const build = await runCmd("npx", ["next", "build"], projectPath, 240_000);
  if (build.code !== 0) {
    return {
      ok: false,
      stage: "build",
      error: (build.stdout + "\n" + build.stderr).slice(0, 4000),
    };
  }
  return { ok: true };
}
