/** Serve built React static export locally with correct /preview basePath. */
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { prepareStaticServeRoot } from "../src/react-codegen/static-serve.js";

const require = createRequire(import.meta.url);
const port = Number(process.env.HOSTING_LOCAL_PORT ?? 3333);
const projectPath = path.resolve("output/_playground-react");
const outDir = path.join(projectPath, "out");

if (!existsSync(path.join(outDir, "index.html"))) {
  console.error(`No build at ${outDir} — run the playground and generate a site first.`);
  process.exit(1);
}

const { serveDir, urlPath } = await prepareStaticServeRoot(projectPath, outDir);
const serveBin = path.join(path.dirname(require.resolve("serve/package.json")), "build", "main.js");
const url = `http://localhost:${port}${urlPath}`;

console.log(`Serving ${serveDir}`);
console.log(`Open → ${url}`);

const proc = spawn(process.execPath, [serveBin, serveDir, "-l", String(port), "--no-clipboard"], {
  stdio: "inherit",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});

proc.on("exit", (code) => process.exit(code ?? 0));
