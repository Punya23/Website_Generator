import { gzipSync } from "zlib";

const GZIP_HTML = new Set([".html", ".htm"]);

/** Gzip HTML for Supabase Storage — gateway sniffs plain HTML and forces text/plain on GET. */
export function prepareStorageBody(
  filePath: string,
  raw: Buffer,
  gzipHtml: boolean
): { body: Buffer; contentType: string; serveEncoding?: "gzip" } {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (gzipHtml && GZIP_HTML.has(ext)) {
    return {
      body: gzipSync(raw),
      contentType: "application/octet-stream",
      serveEncoding: "gzip",
    };
  }
  return { body: raw, contentType: ext === ".html" ? "text/html" : "" };
}

export function isGzipBytes(bytes: ArrayBuffer | Buffer): boolean {
  const u = bytes instanceof Buffer ? bytes : new Uint8Array(bytes);
  return u.length >= 2 && u[0] === 0x1f && u[1] === 0x8b;
}
