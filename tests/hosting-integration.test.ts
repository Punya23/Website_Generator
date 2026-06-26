import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { uploadStaticOut } from "../src/hosting/storage-publisher.js";

/**
 * Integration test — runs only when Supabase env is configured.
 * Verifies upload + size under 5MB for a minimal static bundle.
 */
describe("hosting integration (requires Supabase)", () => {
  const hasSupabase =
    Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wg-out-"));
    await fs.writeFile(path.join(tmp, "index.html"), "<!DOCTYPE html><html><body>ok</body></html>", "utf8");
    await fs.mkdir(path.join(tmp, "_next", "static"), { recursive: true });
    await fs.writeFile(path.join(tmp, "_next", "static", "app.js"), "console.log('ok')", "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it.skipIf(!hasSupabase)("uploads out/ and stays under 5MB", async () => {
    const slug = `test-${Date.now()}`;
    const result = await uploadStaticOut(tmp, slug);
    expect(result.files).toBeGreaterThanOrEqual(2);
    expect(result.bytes).toBeLessThan(5 * 1024 * 1024);
  });
});
