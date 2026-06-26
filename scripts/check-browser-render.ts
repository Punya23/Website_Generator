/** Playwright check — does the Supabase edge URL render in a real browser? */
import { chromium } from "playwright";

const url =
  process.argv[2] ??
  "https://rurcpmhzyvlhaisdovpq.supabase.co/functions/v1/serve-site/2n-fitness/";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log("url:", url);
  console.log("status:", resp?.status());
  console.log("content-type:", resp?.headers()["content-type"]);
  console.log("title:", await page.title());
  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  const bodyStart = (await page.locator("body").innerText().catch(() => "")).slice(0, 100);
  console.log("h1:", h1);
  console.log("body:", bodyStart);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
