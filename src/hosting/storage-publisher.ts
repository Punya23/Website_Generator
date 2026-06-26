import fs from "fs/promises";
import path from "path";
import { getSupabaseClient, sitesBucket } from "./supabase-client.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { prepareStorageBody } from "./gzip-storage.js";

/** Supabase Storage expects simple MIME types — charset suffixes can fall back to text/plain. */
const STORAGE_MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

export function storageContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return STORAGE_MIME[ext] ?? "application/octet-stream";
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, base)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export function publicStorageUrl(storagePath: string): string {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
  const bucket = sitesBucket();
  return `${base}/storage/v1/object/public/${bucket}/${storagePath}`;
}

export function publishAssetBase(slug: string): string | undefined {
  const edgeFn = process.env.SUPABASE_SITE_FUNCTION?.trim();
  if (!edgeFn) return undefined;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/functions/v1/${edgeFn}/${slug}/`;
}

export function publishedSiteUrl(slug: string, indexPath = "index.html"): string {
  const custom = process.env.SITE_PUBLIC_BASE_URL?.trim();
  if (custom) {
    return custom.replace("{slug}", slug).replace(/\/$/, "") + "/";
  }

  const edgeFn = process.env.SUPABASE_SITE_FUNCTION?.trim();
  if (edgeFn) {
    const base = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
    return `${base}/functions/v1/${edgeFn}/${slug}/`;
  }

  return publicStorageUrl(`${slug}/${indexPath}`);
}

/** Upload all files under outDir to Storage prefix `{slug}/`. */
export async function uploadStaticOut(
  outDir: string,
  slug: string
): Promise<{ bytes: number; files: number }> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase is not configured");

  const bucket = sitesBucket();
  const files = await listFiles(outDir);
  const gzipHtml = Boolean(process.env.SUPABASE_SITE_FUNCTION?.trim());
  let bytes = 0;
  let count = 0;

  for (const filePath of files) {
    const rel = path.relative(outDir, filePath).split(path.sep).join("/");
    const raw = await fs.readFile(filePath);
    const prepared = prepareStorageBody(filePath, raw, gzipHtml);

    if (prepared.serveEncoding === "gzip") {
      // Supabase auto-decompresses gzip — store as .bin sidecar; edge serves with Content-Encoding: gzip
      const binPath = `${slug}/${rel}.bin`;
      bytes += prepared.body.length;
      count += 1;
      await client.storage.from(bucket).remove([binPath]);
      const { error } = await client.storage.from(bucket).upload(
        binPath,
        new Uint8Array(prepared.body),
        { upsert: true, contentType: "application/octet-stream", cacheControl: "3600" }
      );
      if (error) throw new Error(`Storage upload failed for ${binPath}: ${error.message}`);
      await client.storage.from(bucket).remove([`${slug}/${rel}`]);
      continue;
    }

    const storagePath = `${slug}/${rel}`;
    bytes += prepared.body.length;
    count += 1;
    const contentType = prepared.contentType || storageContentType(filePath);
    await client.storage.from(bucket).remove([storagePath]);
    const { error } = await client.storage.from(bucket).upload(
      storagePath,
      new Uint8Array(prepared.body),
      { upsert: true, contentType, cacheControl: "3600" }
    );
    if (error) throw new Error(`Storage upload failed for ${storagePath}: ${error.message}`);
  }

  pipelineLog(`[hosting] Uploaded ${count} files (${bytes} bytes) → ${bucket}/${slug}/`);
  return { bytes, files: count };
}
