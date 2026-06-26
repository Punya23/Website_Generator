import fs from "fs/promises";
import path from "path";
import { rewriteStaticTreeForStorage } from "../hosting/rewrite-static-paths.js";

export async function readProjectBasePath(projectPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "next.config.mjs"), "utf8");
    const match = raw.match(/basePath:\s*["']([^"']+)["']/);
    return match?.[1]?.replace(/\/$/, "") ?? "";
  } catch {
    return "";
  }
}

/** Nest `out/` under basePath so static assets resolve when using serve. */
export async function prepareStaticServeRoot(
  projectPath: string,
  outDir = path.join(projectPath, "out")
): Promise<{ serveDir: string; urlPath: string }> {
  const basePath = await readProjectBasePath(projectPath);
  if (!basePath) {
    return { serveDir: outDir, urlPath: "/" };
  }

  const root = path.join(projectPath, ".preview-serve");
  await fs.rm(root, { recursive: true, force: true });
  const nested = path.join(root, basePath.replace(/^\//, ""));
  await fs.mkdir(nested, { recursive: true });
  await fs.cp(outDir, nested, { recursive: true });

  return { serveDir: root, urlPath: `${basePath}/` };
}

/**
 * Bundle for Cloudflare Pages: nest export under basePath so Next.js client routing matches deployed paths.
 */
export async function prepareCloudflarePagesDir(
  projectPath: string,
  outDir = path.join(projectPath, "out")
): Promise<{ uploadDir: string; urlPath: string; cleanupDir?: string }> {
  const { serveDir, urlPath } = await prepareStaticServeRoot(projectPath, outDir);

  if (urlPath !== "/") {
    const previewRoot = urlPath.replace(/^\//, "").replace(/\/$/, "");
    await fs.writeFile(path.join(serveDir, "_redirects"), `/ /${previewRoot}/ 302\n`, "utf8");
  }

  return { uploadDir: serveDir, urlPath, cleanupDir: serveDir };
}

/**
 * Copy static export and rewrite /preview paths for Supabase Storage (relative URLs + correct MIME).
 */
export async function preparePublishUploadDir(
  projectPath: string,
  outDir = path.join(projectPath, "out"),
  options: { assetBase?: string } = {}
): Promise<{ uploadDir: string; indexPath: string; cleanupDir?: string }> {
  const basePath = await readProjectBasePath(projectPath);
  const root = path.join(projectPath, ".publish-upload");
  await fs.rm(root, { recursive: true, force: true });
  await fs.cp(outDir, root, { recursive: true });

  if (basePath || options.assetBase) {
    await rewriteStaticTreeForStorage(root, basePath || "/preview", options);
  }

  return { uploadDir: root, indexPath: "index.html", cleanupDir: root };
}
