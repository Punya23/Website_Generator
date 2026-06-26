import type { SiteContext } from "../types.js";
import { getSupabaseClient } from "./supabase-client.js";
import { storagePrefixForSlug } from "./slug.js";
import { pipelineLog } from "../util/pipeline-log.js";

export type SiteStatus = "draft" | "building" | "published" | "failed";

export interface SiteRecord {
  id: string;
  slug: string;
  business_name: string;
  site_context: SiteContext;
  status: SiteStatus;
  variation_seed: number | null;
  published_at: string | null;
  storage_prefix: string;
  out_bytes: number | null;
  published_url: string | null;
  created_at: string;
  updated_at: string;
}

export async function upsertSiteContext(
  slug: string,
  ctx: SiteContext,
  status: SiteStatus = "draft"
): Promise<SiteRecord | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const row = {
    slug,
    business_name: ctx.businessName,
    site_context: ctx,
    status,
    variation_seed: ctx.variationSeed ?? null,
    storage_prefix: storagePrefixForSlug(slug),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("sites")
    .upsert(row, { onConflict: "slug" })
    .select()
    .single();

  if (error) {
    pipelineLog(`[hosting] Failed to save site context: ${error.message}`);
    throw new Error(`Supabase save failed: ${error.message}`);
  }

  pipelineLog(`[hosting] Site context saved: ${slug} (${status})`);
  return data as SiteRecord;
}

export async function getSiteBySlug(slug: string): Promise<SiteRecord | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.from("sites").select().eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return (data as SiteRecord | null) ?? null;
}

export async function markSiteBuilding(slug: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  await client
    .from("sites")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("slug", slug);
}

export async function markSitePublished(
  slug: string,
  outBytes: number,
  publishedUrl: string
): Promise<SiteRecord | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("sites")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      out_bytes: outBytes,
      published_url: publishedUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("slug", slug)
    .select()
    .single();

  if (error) throw new Error(`Supabase publish update failed: ${error.message}`);
  return data as SiteRecord;
}

export async function markSiteFailed(slug: string, message: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  await client
    .from("sites")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("slug", slug);

  const site = await getSiteBySlug(slug);
  if (site) {
    await client.from("builds").insert({
      site_id: site.id,
      finished_at: new Date().toISOString(),
      status: "failed",
      error: message,
    });
  }
}

export async function recordBuildSuccess(siteId: string, outBytes: number): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  await client.from("builds").insert({
    site_id: siteId,
    finished_at: new Date().toISOString(),
    status: "succeeded",
    out_bytes: outBytes,
  });
}
