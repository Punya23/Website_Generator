import "../src/load-env.js";
import { getSupabaseClient, sitesBucket } from "../src/hosting/supabase-client.js";
import { isGzipBytes } from "../src/hosting/gzip-storage.js";

const client = getSupabaseClient()!;
for (const p of ["2n-fitness/index.html", "2n-fitness/index.html.bin"]) {
  const { data, error } = await client.storage.from(sitesBucket()).download(p);
  if (error) {
    console.log(p, "MISSING", error.message);
    continue;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  console.log(p, buf.length, "gzip:", isGzipBytes(buf), "magic:", buf.slice(0, 2).toString("hex"));
}
