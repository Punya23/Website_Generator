import type { SiteContext } from "../types.js";
import { isSupabaseConfigured } from "./supabase-client.js";
import { cleanupAfterPublish } from "./cleanup-artifacts.js";
import {
  getSiteBySlug,
  markSiteBuilding,
  markSiteFailed,
  markSitePublished,
  recordBuildSuccess,
  upsertSiteContext,
} from "./site-repository.js";
import { publishedSiteUrl, publishAssetBase, uploadStaticOut } from "./storage-publisher.js";
import { siteSlugFromName } from "./slug.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { preparePublishUploadDir } from "../react-codegen/static-serve.js";
import fs from "fs/promises";
import os from "node:os";
import path from "node:path";
import { pageFileName, type FileCopy } from "../templates/compose.js";

export interface PublishSiteInput {
  ctx: SiteContext;
  outPath: string;
  projectPath: string;
  slug?: string;
}

export interface PublishSiteResult {
  slug: string;
  publishedUrl: string;
  outBytes: number;
  fileCount: number;
}

export async function saveSiteAfterGeneration(ctx: SiteContext, slug?: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const siteSlug = slug ?? siteSlugFromName(ctx.businessName);
  await upsertSiteContext(siteSlug, ctx, "draft");
  return siteSlug;
}

export async function publishSite(input: PublishSiteInput): Promise<PublishSiteResult> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const slug = input.slug ?? siteSlugFromName(input.ctx.businessName);
  await upsertSiteContext(slug, input.ctx, "draft");
  await markSiteBuilding(slug);

  try {
    const stats = await cleanupAfterPublish(input.projectPath, input.outPath);
    const bundle = await preparePublishUploadDir(input.projectPath, input.outPath, {
      assetBase: publishAssetBase(slug),
    });
    try {
      const upload = await uploadStaticOut(bundle.uploadDir, slug);
      const publishedUrl = publishedSiteUrl(slug, bundle.indexPath);

      const site = await markSitePublished(slug, upload.bytes, publishedUrl);
      if (site) await recordBuildSuccess(site.id, upload.bytes);

      pipelineLog(`[hosting] Published ${slug} → ${publishedUrl}`);
      if (process.env.SUPABASE_SITE_FUNCTION?.trim()) {
        pipelineLog(
          `[hosting] Note: Supabase cannot render HTML in browsers (platform serves HTML as plain text). ` +
            `For a live preview use: npm run hosting:local  OR  npm run hosting:pages -- ${slug}`
        );
      }
      return {
        slug,
        publishedUrl,
        outBytes: upload.bytes,
        fileCount: upload.files,
      };
    } finally {
      if (bundle.cleanupDir) {
        await fs.rm(bundle.cleanupDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markSiteFailed(slug, message);
    throw err;
  }
}

export interface PublishVerbatimInput {
  ctx: SiteContext;
  /** Clean composed pages — never the preview copy, which carries the authoring layer. */
  htmlPages: Record<string, string>;
  /** Stylesheets and assets the pages reference, as composition emitted them. */
  files: FileCopy[];
  slug?: string;
}

/**
 * Publish a verbatim-template site.
 *
 * `publishSite` above is React-specific: it cleans a Next project and runs the export through
 * `preparePublishUploadDir`, which rewrites Next's `_next/*` asset paths. A verbatim site has no
 * project and no build — it is already a flat set of HTML pages plus a copy list, which is exactly
 * what the uploader wants. So this stages that set to a temp directory and uploads it directly,
 * which is what made publishing possible for these sites at all (the button used to 400: "no built
 * React site in session").
 */
export async function publishVerbatimSite(input: PublishVerbatimInput): Promise<PublishSiteResult> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const slug = input.slug ?? siteSlugFromName(input.ctx.businessName);
  await upsertSiteContext(slug, input.ctx, "draft");
  await markSiteBuilding(slug);

  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "verbatim-publish-"));
  try {
    for (const [pageSlug, html] of Object.entries(input.htmlPages)) {
      await fs.writeFile(path.join(stageDir, pageFileName(pageSlug)), html, "utf8");
    }
    for (const file of input.files) {
      const target = path.resolve(stageDir, file.to);
      // Never let a copy entry write outside the staged site.
      if (!target.startsWith(stageDir)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.from, target).catch(() => {});
    }

    const upload = await uploadStaticOut(stageDir, slug);
    const publishedUrl = publishedSiteUrl(slug, "index.html");
    const site = await markSitePublished(slug, upload.bytes, publishedUrl);
    if (site) await recordBuildSuccess(site.id, upload.bytes);

    pipelineLog(`[hosting] Published verbatim site ${slug} → ${publishedUrl}`);
    return { slug, publishedUrl, outBytes: upload.bytes, fileCount: upload.files };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markSiteFailed(slug, message);
    throw err;
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function publishSiteBySlug(
  slug: string,
  outPath: string,
  projectPath: string
): Promise<PublishSiteResult> {
  const site = await getSiteBySlug(slug);
  if (!site) throw new Error(`Site not found: ${slug}`);
  return publishSite({
    ctx: site.site_context,
    outPath,
    projectPath,
    slug,
  });
}

export function autoPublishEnabled(): boolean {
  return process.env.AUTO_PUBLISH === "1" && isSupabaseConfigured();
}
