import { execSync } from "child_process";
import { pipelineLog } from "./pipeline-log.js";

let checked = false;

/** Ensure Chromium is installed for vision QA screenshots. Runs at most once per process. */
export async function ensurePlaywrightBrowsers(): Promise<void> {
  if (checked || process.env.SKIP_PLAYWRIGHT_SETUP === "1") return;
  checked = true;

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return;
  } catch {
    pipelineLog("[setup] Playwright Chromium missing — installing (one-time)…");
  }

  try {
    execSync("npx playwright install chromium", {
      stdio: "inherit",
      env: process.env,
    });
    pipelineLog("[setup] Playwright Chromium ready");
  } catch (err) {
    pipelineLog(
      `[setup] Playwright install failed: ${err instanceof Error ? err.message : String(err)} — run: npm run setup`
    );
  }
}
