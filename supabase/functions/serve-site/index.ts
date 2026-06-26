import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = Deno.env.get("SUPABASE_SITES_BUCKET") ?? "sites";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function corsHeaders(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*" };
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}

function isGzip(bytes: ArrayBuffer): boolean {
  const u = new Uint8Array(bytes);
  return u.length >= 2 && u[0] === 0x1f && u[1] === 0x8b;
}

function resolveObjectPath(pathAfterSlug: string): string {
  const trimmed = pathAfterSlug.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "index.html";
  if (trimmed.endsWith("/")) return `${trimmed}index.html`;
  if (!/\.\w{1,8}$/.test(trimmed.split("/").pop() ?? "")) {
    return `${trimmed}/index.html`;
  }
  return trimmed;
}

function parseRoute(pathname: string): { slug: string; pathAfterSlug: string } | null {
  const prefix = "/serve-site/";
  const idx = pathname.indexOf(prefix);
  if (idx < 0) return null;

  const rest = pathname.slice(idx + prefix.length).replace(/^\/+/, "");
  if (!rest) return null;

  const slash = rest.indexOf("/");
  if (slash < 0) {
    return { slug: rest, pathAfterSlug: "" };
  }

  return {
    slug: rest.slice(0, slash),
    pathAfterSlug: rest.slice(slash + 1),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(req.url);
  const route = parseRoute(url.pathname);
  if (!route) {
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  }

  const { slug, pathAfterSlug } = route;

  const hasFileExt = /\.\w{1,8}$/.test(pathAfterSlug.split("/").pop() ?? pathAfterSlug);
  if (!url.pathname.endsWith("/") && !hasFileExt && !pathAfterSlug) {
    const redirectTo = `https://${url.host}/functions/v1/serve-site/${slug}/`;
    return Response.redirect(redirectTo, 308);
  }

  const rel = resolveObjectPath(pathAfterSlug);
  const storagePath = `${slug}/${rel}`;
  const binPath = `${storagePath}.bin`;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let bytes: ArrayBuffer;
  let fromBin = false;

  const binResult = await supabase.storage.from(BUCKET).download(binPath);
  if (!binResult.error && binResult.data) {
    bytes = await binResult.data.arrayBuffer();
    fromBin = true;
  } else {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      return new Response(`Not found: ${storagePath}`, { status: 404, headers: corsHeaders() });
    }
    bytes = await data.arrayBuffer();
  }

  const servedType = contentTypeFor(rel);

  const headers: Record<string, string> = {
    "Content-Type": servedType,
    "Content-Disposition": "inline",
    "Cache-Control": "public, max-age=3600",
    ...corsHeaders(),
  };

  if (fromBin && isGzip(bytes)) {
    headers["Content-Encoding"] = "gzip";
  }

  return new Response(bytes, { headers });
});
