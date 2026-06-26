import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

async function readBasePath() {
  try {
    const raw = await fs.readFile(path.join(projectRoot, "next.config.mjs"), "utf8");
    const match = raw.match(/basePath:\s*["']([^"']+)["']/);
    return match?.[1]?.replace(/\/$/, "") ?? "";
  } catch {
    return "";
  }
}

const port = Number(process.env.PORT ?? 3850);
const outDir = path.join(projectRoot, "out");
await fs.access(path.join(outDir, "index.html"));

const basePath = await readBasePath();
let serveDir = outDir;
let url = `http://localhost:${port}/`;

if (basePath) {
  const root = path.join(projectRoot, ".preview-serve");
  await fs.rm(root, { recursive: true, force: true });
  const nested = path.join(root, basePath.replace(/^\//, ""));
  await fs.mkdir(nested, { recursive: true });
  await fs.cp(outDir, nested, { recursive: true });
  serveDir = root;
  url = `http://localhost:${port}/${basePath.replace(/^\//, "")}/`;
}

let bin;
try {
  bin = path.join(path.dirname(require.resolve("serve/package.json")), "build", "main.js");
} catch {
  console.error("Missing serve — run: npm install -D serve");
  process.exit(1);
}

console.log(`Static preview → ${url}`);
spawn(process.execPath, [bin, serveDir, "-l", String(port), "--no-clipboard"], {
  stdio: "inherit",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});
