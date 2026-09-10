/**
 * Zip -> a single "real template root" directory on disk.
 *
 * Extraction is hand-rolled on yauzl rather than using `extract-zip`, whose every published
 * version (<=2.0.1) carries an unpatched unvalidated-symlink path traversal advisory
 * (GHSA-jmr9-qjv8-65gv, CVSS 8.1). These archives come from an unaudited local bundle, so each
 * entry is validated to stay inside the destination directory, symlink entries are refused
 * outright (an HTML template never needs one), and total entry count / uncompressed size are
 * capped against zip bombs.
 */
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import {
  templateMaxEntries,
  templateMaxNestedZipDepth,
  templateMaxUncompressedBytes,
} from "../config.js";

const UNIX_SYMLINK_MODE = 0xa000;
const UNIX_MODE_MASK = 0xf000;

export interface ExtractResult {
  destDir: string;
  entries: number;
  bytes: number;
  skipped: string[];
}

function isUnsafeEntryName(name: string): boolean {
  if (!name || name.startsWith("/") || name.startsWith("\\")) return true;
  if (path.isAbsolute(name)) return true;
  if (/^[a-zA-Z]:/.test(name)) return true; // windows drive-absolute
  return name.split(/[\\/]/).some((part) => part === "..");
}

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  // Upper 16 bits of externalFileAttributes hold the unix mode for zips written on unix.
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & UNIX_MODE_MASK) === UNIX_SYMLINK_MODE;
}

/** Extract one zip into destDir with zip-slip, symlink and zip-bomb guards. */
export async function extractZipSafely(zipPath: string, destDir: string): Promise<ExtractResult> {
  const maxEntries = templateMaxEntries();
  const maxBytes = templateMaxUncompressedBytes();
  await fs.mkdir(destDir, { recursive: true });
  const resolvedDest = await fs.realpath(destDir);
  const skipped: string[] = [];
  let entries = 0;
  let bytes = 0;

  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, file) => {
      if (err || !file) reject(err ?? new Error(`Could not open ${zipPath}`));
      else resolve(file);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      zipFile.close();
      reject(err);
    };

    zipFile.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        try {
          entries += 1;
          if (entries > maxEntries) {
            fail(new Error(`${path.basename(zipPath)}: more than ${maxEntries} entries — refusing`));
            return;
          }
          if (isUnsafeEntryName(entry.fileName)) {
            skipped.push(`unsafe path: ${entry.fileName}`);
            zipFile.readEntry();
            return;
          }
          if (isSymlinkEntry(entry)) {
            skipped.push(`symlink: ${entry.fileName}`);
            zipFile.readEntry();
            return;
          }

          const target = path.resolve(resolvedDest, entry.fileName);
          if (target !== resolvedDest && !target.startsWith(resolvedDest + path.sep)) {
            skipped.push(`escapes dest: ${entry.fileName}`);
            zipFile.readEntry();
            return;
          }

          if (entry.fileName.endsWith("/")) {
            await fs.mkdir(target, { recursive: true });
            zipFile.readEntry();
            return;
          }

          bytes += entry.uncompressedSize;
          if (bytes > maxBytes) {
            fail(
              new Error(
                `${path.basename(zipPath)}: uncompressed size exceeds ${maxBytes} bytes — refusing`
              )
            );
            return;
          }

          await fs.mkdir(path.dirname(target), { recursive: true });
          const readStream = await new Promise<NodeJS.ReadableStream>((res, rej) => {
            zipFile.openReadStream(entry, (err, stream) => {
              if (err || !stream) rej(err ?? new Error(`No stream for ${entry.fileName}`));
              else res(stream);
            });
          });
          await pipeline(readStream, createWriteStream(target));
          zipFile.readEntry();
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });

    zipFile.on("end", resolve);
    zipFile.on("error", fail);
    zipFile.readEntry();
  });

  return { destDir, entries, bytes, skipped };
}

/** Extract nested zips in place (Kelsey ships the real template inside `xhtml.zip`). */
export async function extractNestedZips(rootDir: string, depth = 0): Promise<void> {
  if (depth >= templateMaxNestedZipDepth()) return;
  const nested = await findFiles(rootDir, (name) => name.toLowerCase().endsWith(".zip"));
  for (const zipPath of nested) {
    const target = zipPath.replace(/\.zip$/i, "");
    try {
      await extractZipSafely(zipPath, target);
      await fs.rm(zipPath, { force: true });
      await extractNestedZips(target, depth + 1);
    } catch {
      // A nested archive we cannot read is not fatal — the outer template may still be usable.
    }
  }
}

/** macOS zip resource-fork junk: `__MACOSX/` mirrors the whole real tree one-for-one with
 *  `._<name>` AppleDouble stub files (a handful of metadata bytes, not content) — confirmed live
 *  across 126 of 906 real bundle zips (any archive zipped on a Mac via Finder/Etsy seller tooling).
 *  Both match `/\.html?$/i` by suffix alone, so left unfiltered `__MACOSX/foo/index.html`'s stub
 *  ties or beats the real `foo/index.html` on file count, producing a false "ambiguous root". */
function isJunkEntry(name: string): boolean {
  return name === "__MACOSX" || name === ".DS_Store" || name.startsWith("._");
}

async function findFiles(dir: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isJunkEntry(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && match(entry.name)) out.push(full);
    }
  };
  await walk(dir);
  return out;
}

export interface TemplateRootPick {
  /** Directory holding the real template, absolute. Undefined when the heuristic was inconclusive. */
  rootDir?: string;
  htmlFiles: string[];
  /** Set when the pick is too close to call — the caller should park the template for review
   *  rather than guessing, which matters at 1000+ template scale. */
  needsReview?: string;
}

const DOC_DIR_RE = /(^|[\\/._-])(documentation|documentations|docs?|readme|licen[sc]e|changelog)([\\/._-]|$)/i;

/**
 * Pick the directory that actually holds the template, discarding documentation/demo folders.
 * Confirmed real cases this handles: Arup (`arup-html-files/` 17 pages vs `arup-documentations/`
 * 1 page) and Kelsey (`xhtml/` vs `documentation/` after nested-zip extraction).
 */
export async function pickTemplateRoot(rootDir: string): Promise<TemplateRootPick> {
  const htmlFiles = await findFiles(rootDir, (name) => /\.html?$/i.test(name));
  if (htmlFiles.length === 0) {
    return { htmlFiles, needsReview: "no HTML files found in archive" };
  }

  const byDir = new Map<string, string[]>();
  for (const file of htmlFiles) {
    const dir = path.dirname(file);
    const list = byDir.get(dir) ?? [];
    list.push(file);
    byDir.set(dir, list);
  }

  // Short-circuit: one directory holding ~all the HTML is the template, no scoring needed.
  for (const [dir, files] of byDir) {
    if (files.length / htmlFiles.length >= 0.9 && !DOC_DIR_RE.test(path.relative(rootDir, dir) || ".")) {
      return { rootDir: dir, htmlFiles: files };
    }
  }

  const scored = await Promise.all(
    [...byDir.entries()].map(async ([dir, files]) => {
      const rel = path.relative(rootDir, dir) || ".";
      let score = files.length;
      if (DOC_DIR_RE.test(rel)) score -= 5;
      if (files.some((file) => /(^|[\\/])(index|home)\.html?$/i.test(file))) score += 2;
      if (await hasRealStylesheet(dir)) score += 1;
      return { dir, files, score };
    })
  );
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) {
    return { htmlFiles, needsReview: "no directory scored as a template root" };
  }
  const runnerUp = scored[1];
  if (runnerUp && runnerUp.score > 0 && runnerUp.score >= best.score * 0.8) {
    return {
      htmlFiles,
      needsReview: `ambiguous template root: ${path.relative(rootDir, best.dir)} (${best.score}) vs ${path.relative(rootDir, runnerUp.dir)} (${runnerUp.score})`,
    };
  }

  return { rootDir: best.dir, htmlFiles: best.files };
}

async function hasRealStylesheet(dir: string): Promise<boolean> {
  const cssFiles = await findFiles(dir, (name) => name.toLowerCase().endsWith(".css"));
  for (const file of cssFiles.slice(0, 40)) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 5_000) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export { findFiles };
