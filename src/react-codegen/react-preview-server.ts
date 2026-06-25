import { spawn, type ChildProcess } from "child_process";
import http from "http";
import path from "path";
import fs from "fs/promises";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let previewProc: ChildProcess | null = null;

export function getReactPreviewPort(): number {
  return Number(process.env.REACT_PREVIEW_PORT ?? 3850);
}

export function stopReactPreviewServer(): void {
  if (!previewProc) return;
  previewProc.kill("SIGTERM");
  previewProc = null;
}

function serveBin(): string {
  const pkg = require.resolve("serve/package.json");
  return path.join(path.dirname(pkg), "build", "main.js");
}

async function waitForHttp(url: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(Boolean(res.statusCode && res.statusCode < 500));
        });
        req.on("error", () => resolve(false));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Preview server did not respond at ${url}`);
}

/** Serve the Next.js static export (`out/`) on localhost after `npm run build`. */
export async function startReactPreviewServer(projectPath: string): Promise<string> {
  stopReactPreviewServer();

  const outDir = path.join(projectPath, "out");
  await fs.access(path.join(outDir, "index.html"));

  const port = getReactPreviewPort();
  const bin = serveBin();

  previewProc = spawn(process.execPath, [bin, outDir, "-l", String(port), "--no-clipboard"], {
    stdio: "pipe",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });

  previewProc.on("exit", () => {
    previewProc = null;
  });

  const url = `http://localhost:${port}`;
  await waitForHttp(url);
  return url;
}
