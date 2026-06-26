import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  cleanupBuildArtifacts,
  measureDirectory,
} from "../src/hosting/cleanup-artifacts.js";
import { siteSlugFromName, storagePrefixForSlug } from "../src/hosting/slug.js";
import { publicStorageUrl, publishedSiteUrl } from "../src/hosting/storage-publisher.js";
import { isSupabaseConfigured } from "../src/hosting/supabase-client.js";
import { autoPublishEnabled } from "../src/hosting/publish-site.js";

describe("hosting slug", () => {
  it("slugifies business names", () => {
    expect(siteSlugFromName("Moonrise Bakery")).toBe("moonrise-bakery");
    expect(storagePrefixForSlug("moonrise-bakery")).toBe("sites/moonrise-bakery");
  });
});

describe("cleanup artifacts", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wg-cleanup-"));
    await fs.mkdir(path.join(tmp, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(tmp, ".next"), { recursive: true });
    await fs.mkdir(path.join(tmp, "out"), { recursive: true });
    await fs.writeFile(path.join(tmp, "out", "index.html"), "<html></html>", "utf8");
    await fs.writeFile(path.join(tmp, "package-lock.json"), "{}", "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("removes node_modules and .next but keeps out/", async () => {
    await cleanupBuildArtifacts(tmp);
    await expect(fs.access(path.join(tmp, "node_modules"))).rejects.toThrow();
    await expect(fs.access(path.join(tmp, ".next"))).rejects.toThrow();
    await expect(fs.access(path.join(tmp, "out", "index.html"))).resolves.toBeUndefined();
  });

  it("measures directory size", async () => {
    const stats = await measureDirectory(path.join(tmp, "out"));
    expect(stats.files).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });
});

describe("storage URLs", () => {
  it("builds public storage URL", () => {
    const prev = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://abc.supabase.co";
    expect(publicStorageUrl("moonrise-bakery/index.html")).toContain(
      "/storage/v1/object/public/sites/moonrise-bakery/index.html"
    );
    if (prev === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prev;
  });

  it("supports custom public base URL template", () => {
    const prev = process.env.SITE_PUBLIC_BASE_URL;
    process.env.SITE_PUBLIC_BASE_URL = "https://{slug}.example.com";
    expect(publishedSiteUrl("moonrise-bakery")).toBe("https://moonrise-bakery.example.com/");
    if (prev === undefined) delete process.env.SITE_PUBLIC_BASE_URL;
    else process.env.SITE_PUBLIC_BASE_URL = prev;
  });

  it("uses edge function URL when configured", () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevFn = process.env.SUPABASE_SITE_FUNCTION;
    process.env.SUPABASE_URL = "https://abc.supabase.co";
    process.env.SUPABASE_SITE_FUNCTION = "serve-site";
    expect(publishedSiteUrl("moonrise-bakery")).toBe(
      "https://abc.supabase.co/functions/v1/serve-site/moonrise-bakery/"
    );
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevFn === undefined) delete process.env.SUPABASE_SITE_FUNCTION;
    else process.env.SUPABASE_SITE_FUNCTION = prevFn;
  });
});

describe("supabase configuration", () => {
  it("reports not configured without env", () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isSupabaseConfigured()).toBe(false);
    expect(autoPublishEnabled()).toBe(false);
    if (url) process.env.SUPABASE_URL = url;
    if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  });
});
