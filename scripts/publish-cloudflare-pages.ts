/**
 * Deploy static out/ to Cloudflare Pages (renders HTML correctly).
 * Requires: npx wrangler login  OR  CLOUDFLARE_API_TOKEN env
 *
 * Usage: npx tsx scripts/publish-cloudflare-pages.ts [slug]
 */
import "../src/load-env.js";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { prepareCloudflarePagesDir } from "../src/react-codegen/static-serve.js";

async function main() {
  const slug = process.argv[2] ?? "2n-fitness";
  const projectPath = path.resolve("output/_playground-react");
  const outPath = path.join(projectPath, "out");

  if (!existsSync(path.join(outPath, "index.html"))) {
    console.error(`Missing build at ${outPath} — generate a site first.`);
    process.exit(1);
  }

  const projectName = `wg-${slug}`.replace(/[^a-z0-9-]/g, "-").slice(0, 58);

  // Nest under basePath (/preview) so Next.js client nav and assets resolve on Pages
  const bundle = await prepareCloudflarePagesDir(projectPath, outPath);
  const deployDir = bundle.uploadDir;
  const liveUrl = `https://main.${projectName}.pages.dev${bundle.urlPath}`;

  console.log(`Deploying ${deployDir} → Cloudflare Pages project "${projectName}"…`);

  execSync(
    `npx wrangler@3 pages deploy "${deployDir}" --project-name="${projectName}" --branch=main --commit-dirty=true`,
    { stdio: "inherit", env: process.env }
  );

  console.log(`\nLive site: ${liveUrl}`);

  if (bundle.cleanupDir) {
    await fs.rm(bundle.cleanupDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
