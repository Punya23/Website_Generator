import fs from "fs/promises";
import path from "path";
import { pipelineLog } from "../util/pipeline-log.js";

export interface DirectoryStats {
  bytes: number;
  files: number;
}

export async function measureDirectory(dirPath: string): Promise<DirectoryStats> {
  let bytes = 0;
  let files = 0;

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files += 1;
        const stat = await fs.stat(full);
        bytes += stat.size;
      }
    }
  }

  await walk(dirPath);
  return { bytes, files };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Remove heavy build artifacts; keep static `out/` for hosting. */
export async function cleanupBuildArtifacts(projectPath: string): Promise<void> {
  const targets = ["node_modules", ".next", "package-lock.json"];
  for (const name of targets) {
    const target = path.join(projectPath, name);
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

export async function logStaticExportSize(outPath: string): Promise<DirectoryStats> {
  const stats = await measureDirectory(outPath);
  pipelineLog(
    `[pipeline] Static export: ${formatBytes(stats.bytes)} (${stats.files} files) at ${outPath}`
  );
  return stats;
}

export async function cleanupAfterPublish(
  projectPath: string,
  outPath: string
): Promise<DirectoryStats> {
  const stats = await logStaticExportSize(outPath);
  await cleanupBuildArtifacts(projectPath);
  pipelineLog(`[pipeline] Build artifacts cleaned (node_modules, .next removed)`);
  return stats;
}
