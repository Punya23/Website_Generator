import { chromium, type Browser } from "playwright";
import type { QAIssue, QAResult } from "../types.js";
import { SUPPORTED_BLOCK_TYPES } from "../agents/content-normalize.js";
import { withTimeout } from "../util/timed.js";

let sharedBrowser: Browser | null = null;
let qaMutex: Promise<void> = Promise.resolve();

const IMAGE_LOAD_TIMEOUT_MS = Number.parseInt(process.env.QA_IMAGE_TIMEOUT_MS ?? "8000", 10);
const QA_PAGE_TIMEOUT_MS = Number.parseInt(process.env.QA_PAGE_TIMEOUT_MS ?? "45000", 10);

export interface BlockManifestEntry {
  id: string;
  type: string;
  top: number;
  height: number;
  width: number;
  sectionId?: string;
}

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

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

  if (/\{"id":\s*"[^"]+",\s*"type":/.test(html)) {
    issues.push({
      severity: "hard",
      code: "RAW_JSON_LEAK",
      message: "Page HTML contains raw JSON block data",
      suggestion: "Normalize block types before render or add missing renderer cases",
    });
  }

  for (const match of html.matchAll(/data-block-type="([^"]+)"/g)) {
    const blockType = match[1];
    if (blockType && !SUPPORTED_BLOCK_TYPES.has(blockType)) {
      issues.push({
        severity: "hard",
        code: "UNKNOWN_BLOCK_TYPE",
        message: `Unknown block type rendered: ${blockType}`,
        suggestion: "Coerce to a supported block type in content-normalize",
      });
    }
  }

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
      document.querySelectorAll("[data-block-id]").forEach((el) => {
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
        message: `Overflow on ${o.type} (${o.id})`,
        targetId: o.id !== "unknown" ? o.id : undefined,
        suggestion: "Use Stack instead of Row or reduce columns",
      });
    }

    const gridOrphans = await page.evaluate(() => {
      const orphans: string[] = [];
      document.querySelectorAll('.layout-grid[data-layout="Grid"]').forEach((grid) => {
        if (grid.children.length === 1 && grid.clientWidth > 600) {
          const block = grid.children[0] as HTMLElement;
          orphans.push(block.dataset?.blockId ?? "grid-child");
        }
      });
      return orphans;
    });

    for (const id of gridOrphans) {
      issues.push({
        severity: "soft",
        code: "GRID_ORPHAN",
        message: `Single item in wide grid: ${id}`,
        targetId: id,
        suggestion: "Convert Grid to Stack",
      });
    }

    const heightMismatches = await page.evaluate(() => {
      const rows = document.querySelectorAll('.layout-row[data-layout="Row"]');
      const bad: Array<{ rowId: string; id: string; ratio: number }> = [];
      rows.forEach((row, ri) => {
        const children = Array.from(row.children) as HTMLElement[];
        if (children.length < 2) return;
        const heights = children.map((c) => c.getBoundingClientRect().height);
        const max = Math.max(...heights);
        const min = Math.min(...heights);
        if (max > 0 && min > 0 && max / min > 2.2) {
          const tallest = children[heights.indexOf(max)]!;
          const block = tallest.querySelector("[data-block-id]") as HTMLElement | null;
          bad.push({
            rowId: `row-${ri}`,
            id: block?.dataset.blockId ?? "unknown",
            ratio: max / min,
          });
        }
      });
      return bad;
    });

    for (const m of heightMismatches) {
      issues.push({
        severity: "soft",
        code: "CARD_HEIGHT_MISMATCH",
        message: `Row height mismatch ratio ${m.ratio.toFixed(1)}`,
        targetId: m.id,
        suggestion: "Split Row into Stack",
        metric: m.ratio,
      });
    }

    const imageUrls = await page.evaluate(() => {
      const urls: Array<{ url: string; id: string }> = [];
      document.querySelectorAll("[data-block-id]").forEach((el) => {
        const block = el as HTMLElement;
        const id = block.dataset.blockId!;
        const type = block.dataset.blockType;
        if (type === "headline") {
          const bg = getComputedStyle(block).backgroundImage;
          const m = bg.match(/url\("([^"]+)"\)/);
          if (m?.[1]) urls.push({ url: m[1], id });
        }
        block.querySelectorAll("img[src]").forEach((img) => {
          urls.push({ url: (img as HTMLImageElement).src, id });
        });
      });
      return urls;
    });

    const seen = new Map<string, string>();
    for (const { url, id } of imageUrls) {
      if (!url || url.includes("data:")) continue;
      if (seen.has(url)) {
        issues.push({
          severity: "hard",
          code: "DUPLICATE_IMAGE",
          message: `Duplicate image URL also used by ${seen.get(url)}`,
          targetId: id,
          suggestion: "Use a different image for this block",
        });
      } else {
        seen.set(url, id);
      }
    }

    const brokenImages = await page.evaluate(() => {
      const broken: string[] = [];
      document.querySelectorAll("img[src]").forEach((img) => {
        const el = img as HTMLImageElement;
        const src = el.getAttribute("src")?.trim() ?? "";
        if (!src || src.startsWith("data:")) return;
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
        message: `Broken image in block ${id}`,
        targetId: id,
        suggestion: "Clear src for re-enrichment",
      });
    }

    await page.close();

    // Mobile viewport pass (390px)
    const mobilePage = await browser.newPage();
    await mobilePage.setViewportSize({ width: 390, height: 844 });
    await mobilePage.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });

    const mobileOverflow = await mobilePage.evaluate((tolerance) => {
      const found: string[] = [];
      document.querySelectorAll("[data-block-id]").forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.scrollWidth > htmlEl.clientWidth + tolerance) {
          found.push(htmlEl.dataset.blockId ?? "unknown");
        }
      });
      return found;
    }, OVERFLOW_TOLERANCE_PX);

    for (const id of mobileOverflow) {
      issues.push({
        severity: "soft",
        code: "MOBILE_OVERFLOW",
        message: `Mobile horizontal overflow on block ${id}`,
        targetId: id !== "unknown" ? id : undefined,
        suggestion: "Stack columns on narrow viewports",
      });
    }

    await mobilePage.close();
  } catch (err) {
    issues.push({
      severity: "hard",
      code: "QA_RUNTIME_ERROR",
      message: `QA failed for ${pageSlug}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const hardIssues = issues.filter((i) => i.severity === "hard");
  return { passed: hardIssues.length === 0, issues };
}

export async function extractBlockManifest(html: string): Promise<BlockManifestEntry[]> {
  return withQAMutex(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const manifest = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("[data-block-id]")).map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const section = (el as HTMLElement).closest("[data-section-id]") as HTMLElement | null;
        return {
          id: (el as HTMLElement).dataset.blockId!,
          type: (el as HTMLElement).dataset.blockType ?? "block",
          top: Math.round(r.top),
          height: Math.round(r.height),
          width: Math.round(r.width),
          sectionId: section?.dataset.sectionId,
        };
      });
    });
    await page.close();
    return manifest;
  });
}

export async function screenshotPage(html: string): Promise<string> {
  const dual = await screenshotPageDual(html);
  return dual.desktop;
}

export interface ViewportScreenshots {
  desktop: string;
  mobile: string;
}

export async function screenshotPageDual(html: string): Promise<ViewportScreenshots> {
  return withQAMutex(() =>
    withTimeout(screenshotPageDualInner(html), QA_PAGE_TIMEOUT_MS, "dual screenshot")
  );
}

async function screenshotPageDualInner(html: string): Promise<ViewportScreenshots> {
  const browser = await getBrowser();
  const desktopPage = await browser.newPage();
  await desktopPage.setViewportSize({ width: 1280, height: 800 });
  await desktopPage.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const desktop = (await desktopPage.screenshot({ fullPage: true, type: "png" })).toString("base64");
  await desktopPage.close();

  const mobilePage = await browser.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const mobile = (await mobilePage.screenshot({ fullPage: true, type: "png" })).toString("base64");
  await mobilePage.close();

  return { desktop, mobile };
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
