import fs from "fs/promises";
import path from "path";
import type { SiteContext } from "../types.js";

export async function persistDebugArtifacts(
  ctx: SiteContext,
  screenshots?: Record<string, string>
): Promise<string | null> {
  if (process.env.SKIP_DEBUG_ARTIFACTS === "1") return null;

  const dir = path.resolve(
    "output",
    "_debug",
    ctx.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    String(Date.now())
  );

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "site-context.json"), JSON.stringify(ctx, null, 2), "utf8");

  if (screenshots) {
    for (const [slug, b64] of Object.entries(screenshots)) {
      await fs.writeFile(path.join(dir, `${slug}.png`), Buffer.from(b64, "base64"));
    }
  }

  return dir;
}
