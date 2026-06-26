import "../src/load-env.js";
import path from "path";
import fs from "fs/promises";
import { getSupabaseClient, isSupabaseConfigured, sitesBucket } from "../src/hosting/supabase-client.js";
import { publishSiteBySlug } from "../src/hosting/publish-site.js";

async function main() {
  const checks: Record<string, unknown> = {};

  checks.env = {
    supabaseConfigured: isSupabaseConfigured(),
    bucket: sitesBucket(),
    autoPublish: process.env.AUTO_PUBLISH === "1",
    url: process.env.SUPABASE_URL,
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  const outPath = path.resolve("output/_playground-react/out");
  const projectPath = path.resolve("output/_playground-react");
  try {
    const stat = await fs.stat(path.join(outPath, "index.html"));
    const files = await fs.readdir(outPath);
    checks.buildOutput = { exists: true, indexHtmlBytes: stat.size, topLevel: files };
  } catch (e) {
    checks.buildOutput = { exists: false, error: String(e) };
  }

  const client = getSupabaseClient();
  if (!client) {
    console.log(JSON.stringify({ checks, error: "No Supabase client" }, null, 2));
    process.exit(1);
  }

  try {
    const { data, error } = await client
      .from("sites")
      .select("slug,status,published_url,out_bytes")
      .eq("slug", "2n-fitness")
      .maybeSingle();
    checks.dbSitesTable = error
      ? { ok: false, code: error.code, message: error.message }
      : { ok: true, row: data };
  } catch (e) {
    checks.dbSitesTable = { ok: false, error: String(e) };
  }

  try {
    const bucket = sitesBucket();
    const { data, error } = await client.storage.listBuckets();
    if (error) {
      checks.storageBuckets = { ok: false, message: error.message };
    } else {
      const names = (data ?? []).map((b) => b.name);
      const bucketInfo = (data ?? []).find((b) => b.name === bucket);
      checks.storageBuckets = {
        ok: true,
        all: names,
        target: bucket,
        targetExists: Boolean(bucketInfo),
        targetPublic: bucketInfo?.public ?? null,
      };
    }
  } catch (e) {
    checks.storageBuckets = { ok: false, error: String(e) };
  }

  try {
    const { data, error } = await client.storage.from(sitesBucket()).list("2n-fitness", { limit: 5 });
    checks.storageObjects = error
      ? { ok: false, message: error.message }
      : { ok: true, count: data?.length ?? 0, sample: (data ?? []).map((f) => f.name) };
  } catch (e) {
    checks.storageObjects = { ok: false, error: String(e) };
  }

  const bucketOk = Boolean(
    checks.storageBuckets &&
      typeof checks.storageBuckets === "object" &&
      "targetExists" in checks.storageBuckets &&
      (checks.storageBuckets as { targetExists: boolean }).targetExists
  );
  const buildOk = Boolean(
    checks.buildOutput &&
      typeof checks.buildOutput === "object" &&
      "exists" in checks.buildOutput &&
      (checks.buildOutput as { exists: boolean }).exists
  );

  if (bucketOk && buildOk) {
    try {
      const result = await publishSiteBySlug("2n-fitness", outPath, projectPath);
      checks.publish = { ok: true, ...result };
    } catch (e) {
      checks.publish = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  } else {
    checks.publish = { ok: false, skipped: true, reason: "bucket or build missing" };
  }

  // Post-publish verification
  if (checks.publish && typeof checks.publish === "object" && (checks.publish as { ok?: boolean }).ok) {
    const { data: site } = await client
      .from("sites")
      .select("slug,status,published_url,out_bytes,published_at")
      .eq("slug", "2n-fitness")
      .maybeSingle();
    const { data: files } = await client.storage.from(sitesBucket()).list("2n-fitness", { limit: 10 });
    checks.afterPublish = {
      site,
      storageTopLevel: (files ?? []).map((f) => f.name),
    };
  }

  console.log(JSON.stringify(checks, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
