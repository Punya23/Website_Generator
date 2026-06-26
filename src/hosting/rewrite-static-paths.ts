import fs from "fs/promises";
import path from "path";

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".txt", ".json"]);

/** Depth-relative prefix so assets resolve from nested pages (e.g. about/index.html). */
export function depthRelativePrefix(fileRel: string): string {
  const dir = path.dirname(fileRel.replace(/\\/g, "/"));
  if (dir === ".") return "";
  const depth = dir.split("/").filter(Boolean).length;
  return "../".repeat(depth);
}

/** Rewrite playground basePath (/preview) for Supabase hosting. */
export function rewritePathsForStorage(
  content: string,
  basePath: string,
  fileRel: string,
  options?: { assetBase?: string }
): string {
  if (options?.assetBase) {
    return rewriteToAbsoluteAssetBase(content, basePath, options.assetBase);
  }

  const rel = depthRelativePrefix(fileRel);
  const prefix = basePath.replace(/\/$/, "") || "/preview";

  let out = content;

  out = out.replaceAll(`href="${prefix}/"`, `href="${rel || "./"}"`);
  out = out.replaceAll(`href='${prefix}/'`, `href='${rel || "./"}'`);
  out = out.replaceAll(`href="${prefix}"`, `href="${rel || "./"}"`);
  out = out.replaceAll(`href='${prefix}'`, `href='${rel || "./"}'`);

  out = out.replaceAll(`${prefix}/_next/`, `${rel}_next/`);

  out = out.replaceAll(`href="${prefix}/`, `href="${rel}`);
  out = out.replaceAll(`href='${prefix}/`, `href='${rel}`);

  out = out.replaceAll('href="/contact"', `href="${rel}contact/"`);
  out = out.replaceAll("href='/contact'", `href='${rel}contact/'`);
  out = out.replaceAll('href="/contact/"', `href="${rel}contact/"`);

  out = out.replaceAll(`\\"${prefix}/_next/`, `\\"${rel}_next/`);
  out = out.replaceAll(`\\"${prefix}/`, `\\"${rel}`);
  out = out.replaceAll(`assetPrefix\\":\\"${prefix}\\"`, 'assetPrefix\\":\\"\\"');

  return out;
}

function normalizeAssetBase(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

function rewriteToAbsoluteAssetBase(content: string, basePath: string, assetBase: string): string {
  const base = normalizeAssetBase(assetBase);
  const prefix = basePath.replace(/\/$/, "") || "/preview";
  const assetPrefix = base.replace(/\/$/, "");

  let out = content;

  out = out.replaceAll(`${prefix}/_next/`, `${base}_next/`);
  out = out.replaceAll(`href="${prefix}/`, `href="${base}`);
  out = out.replaceAll(`href='${prefix}/`, `href='${base}`);
  out = out.replaceAll(`href="${prefix}"`, `href="${base}"`);
  out = out.replaceAll(`href='${prefix}'`, `href='${base}'`);

  out = out.replaceAll('href="/contact"', `href="${base}contact/"`);
  out = out.replaceAll("href='/contact'", `href='${base}contact/'`);
  out = out.replaceAll('href="/contact/"', `href="${base}contact/"`);

  // Prior publish pass used relative paths — upgrade to absolute
  out = out.replaceAll('href="_next/', `href="${base}_next/`);
  out = out.replaceAll("href='_next/", `href='${base}_next/`);

  out = out.replaceAll(`\\"${prefix}/_next/`, `\\"${base}_next/`);
  out = out.replaceAll(`\\"${prefix}/`, `\\"${base}`);
  out = out.replaceAll(`assetPrefix\\":\\"${prefix}\\"`, `assetPrefix\\":\\"${assetPrefix}\\"`);

  return out;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function rewriteStaticTreeForStorage(
  rootDir: string,
  basePath: string,
  options?: { assetBase?: string }
): Promise<void> {
  if (!basePath.replace(/\/$/, "") && !options?.assetBase) return;

  const files = await listFiles(rootDir);
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    const rel = path.relative(rootDir, filePath).split(path.sep).join("/");
    const raw = await fs.readFile(filePath, "utf8");
    const rewritten = rewritePathsForStorage(raw, basePath, rel, options);
    if (rewritten !== raw) {
      await fs.writeFile(filePath, rewritten, "utf8");
    }
  }
}
