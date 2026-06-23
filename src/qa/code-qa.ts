import { chromium, type Browser } from "playwright";
import type { QAIssue, QAResult } from "../types.js";
import { withTimeout } from "../util/timed.js";

let sharedBrowser: Browser | null = null;
let qaMutex: Promise<void> = Promise.resolve();

const IMAGE_LOAD_TIMEOUT_MS = Number.parseInt(process.env.QA_IMAGE_TIMEOUT_MS ?? "8000", 10);
const QA_PAGE_TIMEOUT_MS = Number.parseInt(process.env.QA_PAGE_TIMEOUT_MS ?? "45000", 10);

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

/** Serialize Playwright QA — parallel page pipelines share one browser. */
async function withQAMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = qaMutex.then(fn, fn);
  qaMutex = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function closeQABrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

const OVERFLOW_TOLERANCE_PX = 4;

export async function runCodeQA(html: string, pageSlug: string): Promise<QAResult> {
  return withQAMutex(() =>
    withTimeout(runCodeQAInner(html, pageSlug), QA_PAGE_TIMEOUT_MS, `QA for ${pageSlug}`)
  );
}

async function runCodeQAInner(html: string, pageSlug: string): Promise<QAResult> {
  const issues: QAIssue[] = [];

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });

    await page.evaluate((timeoutMs) => {
      const waitImages = Promise.all(
        Array.from(document.images).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
        })
      );
      return Promise.race([
        waitImages,
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }, IMAGE_LOAD_TIMEOUT_MS);

      const overflowIssues = await page.evaluate((tolerance) => {
        const found: Array<{ id: string; type: string; scrollW: number; clientW: number }> = [];
        document.querySelectorAll(".block[data-block-id]").forEach((el) => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.scrollWidth > htmlEl.clientWidth + tolerance) {
            found.push({
              id: htmlEl.dataset.blockId ?? "unknown",
              type: htmlEl.dataset.blockType ?? "block",
              scrollW: htmlEl.scrollWidth,
              clientW: htmlEl.clientWidth,
            });
          }
        });
        return found;
      }, OVERFLOW_TOLERANCE_PX);

      for (const o of overflowIssues) {
        issues.push({
          severity: "hard",
          code: "HORIZONTAL_OVERFLOW",
          message: `Horizontal overflow on ${o.type} (${o.id}): scroll ${o.scrollW}px > client ${o.clientW}px`,
          targetId: o.id !== "unknown" ? o.id : undefined,
          suggestion: "Widen grid minColumnWidth or switch Row to Stack",
        });
      }

      const gridOrphans = await page.evaluate(() => {
        const orphans: string[] = [];
        document.querySelectorAll('.layout-grid[data-layout="Grid"]').forEach((grid) => {
          const items = grid.children;
          if (items.length === 1 && grid.clientWidth > 600) {
            const block = items[0] as HTMLElement;
            orphans.push(block.dataset.blockId ?? "grid-child");
          }
        });
        return orphans;
      });

      for (const id of gridOrphans) {
        issues.push({
          severity: "soft",
          code: "GRID_ORPHAN",
          message: `Single item orphaned in wide grid: ${id}`,
          targetId: id,
          suggestion: "Convert Grid to Stack for this section",
        });
      }

      const longTextBlocks = await page.evaluate(() => {
        const long: Array<{ id: string; length: number }> = [];
        document.querySelectorAll("[data-block-id]").forEach((el) => {
          const text = (el as HTMLElement).innerText;
          if (text.length > 500) {
            long.push({ id: (el as HTMLElement).dataset.blockId!, length: text.length });
          }
        });
        return long;
      });

      for (const lt of longTextBlocks) {
        issues.push({
          severity: "soft",
          code: "TEXT_OVERFLOW",
          message: `Block ${lt.id} has ${lt.length} chars — may look cramped`,
          targetId: lt.id,
          suggestion: "Shorten headline or quote text",
        });
      }

      const brokenImages = await page.evaluate(() => {
        const broken: string[] = [];
        document.querySelectorAll("img[src]").forEach((img) => {
          const el = img as HTMLImageElement;
          const src = el.getAttribute("src")?.trim() ?? "";
          if (!src || src.startsWith("data:")) return;
          if (src.includes("images.unsplash.com") && el.naturalWidth > 0) return;
          if (!el.complete || el.naturalWidth === 0) {
            const parent = el.closest("[data-block-id]") as HTMLElement | null;
            broken.push(parent?.dataset.blockId ?? "image");
          }
        });
        return broken;
      });

      for (const id of brokenImages) {
        issues.push({
          severity: "hard",
          code: "BROKEN_IMAGE",
          message: `Broken or missing image in block ${id}`,
          targetId: id,
          suggestion: "Remove src or use placeholder",
        });
      }

      await page.close();
    } catch (err) {
      issues.push({
        severity: "hard",
        code: "QA_RUNTIME_ERROR",
        message: `QA could not run for ${pageSlug}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const hardIssues = issues.filter((i) => i.severity === "hard");
    return {
      passed: hardIssues.length === 0,
      issues,
    };
}

export async function screenshotPage(html: string): Promise<string> {
  return withQAMutex(() =>
    withTimeout(screenshotPageInner(html), QA_PAGE_TIMEOUT_MS, "screenshot")
  );
}

async function screenshotPageInner(html: string): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const buffer = await page.screenshot({ fullPage: true, type: "png" });
  await page.close();
  return buffer.toString("base64");
}
