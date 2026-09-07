import { chromium, type Browser } from "playwright";
import * as cheerio from "cheerio";
import type { QAIssue, QAResult } from "../types.js";
import { SUPPORTED_BLOCK_TYPES } from "../agents/content-normalize.js";
import { withTimeout } from "../util/timed.js";
import { scanHtmlForFillerLeaks } from "../templates/filler-patterns.js";

let sharedBrowser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;
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
  /** Set only for a manifest entry describing a verbatim-template section (`extractTemplateSection
   *  ManifestFromUrl`) — which source template this section's markup came from. Lets the vision
   *  judge (and a human reading the same JSON) tell "these two adjacent, differently-sized sections
   *  are from different templates" from "one component just rendered oddly on its own". */
  templateId?: string;
}

/** Safe under concurrent callers — without the shared in-flight promise, two callers that both
 *  see `sharedBrowser` as null before either awaits would each launch their own browser process,
 *  leaking one. A single browser instance safely serves many concurrent pages/contexts (a
 *  supported Playwright pattern), so callers no longer need to be serialized through this. */
async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  if (!browserLaunch) {
    browserLaunch = chromium.launch({ headless: true });
  }
  sharedBrowser = await browserLaunch;
  return sharedBrowser;
}

/** Shared with the ingest admin so a discovery run and a QA pass reuse one chromium process
 *  instead of launching a second. Closed by `closeQABrowser()`. */
export async function getSharedBrowser(): Promise<Browser> {
  return getBrowser();
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
  browserLaunch = null;
}

const OVERFLOW_TOLERANCE_PX = 4;

/** A JS-side templating slip landing verbatim in shipped copy — a field that was `undefined`/`null`
 *  got interpolated instead of guarded. Own check, own message: this is a different failure than a
 *  raw JSON envelope (`looksLikeRawJson`) even though both are "text that shouldn't be there". */
const UNDEFINED_LEAK_RE = /(^|[\s>])(undefined|null|NaN|\[object Object\])([\s<.,!?]|$)/;

/**
 * Structural, no-vision, no-Playwright check over every `[data-tpl][data-section]` wrapper
 * `templates/compose.ts` emits — one pass per SECTION rather than one aggregate pass over the whole
 * page, so a single corrupted section names itself (`sectionId`) instead of surfacing as "something
 * on this page is wrong" that a human then has to hunt for across a dozen sections. Runs before the
 * browser is ever touched — cheap enough to run on every page, every generation, every time
 * (`code-qa.ts`'s doc comment: "let the time increase" is fine, this barely costs any).
 *
 * Falls back to the old whole-page-only scan when no section markers are present at all (the
 * react-codegen/classic block renderer doesn't emit them) — this function is additive, not a
 * replacement for that path.
 */
function validateSectionsStructurally(html: string, businessName?: string): QAIssue[] {
  const $ = cheerio.load(html, null, false);
  const sections = $("[data-tpl][data-section]").toArray();
  if (sections.length === 0) {
    return scanHtmlForFillerLeaks(html, businessName).map((leak) => ({
      severity: "hard" as const,
      code: leak.code === "rawJson" ? "RAW_JSON_LEAK" : "TEMPLATE_FILLER_LEAK",
      message: `${leak.code} leak at ${leak.selector}: "${leak.sample}"`,
      suggestion:
        leak.code === "rawJson"
          ? "Guard whatever LLM copy step wrote this field against JSON-shaped output before splicing it in"
          : "Widen copy-slot coverage on the source template, or its filler-neutralization pass, for this shape",
    }));
  }

  const issues: QAIssue[] = [];
  for (const node of sections) {
    const el = $(node);
    const templateId = el.attr("data-tpl") ?? "unknown";
    const sectionId = el.attr("data-section") ?? "unknown";
    const role = el.attr("data-role") ?? "unknown";
    const text = el.text().replace(/\s+/g, " ").trim();
    const hasMedia =
      el.find("img, svg, video, picture, source").length > 0 ||
      /background-image\s*:\s*url\(/i.test(el.attr("style") ?? "") ||
      el.find("[style*='background-image']").length > 0;

    if (!text && !hasMedia) {
      issues.push({
        severity: "hard",
        code: "EMPTY_SECTION",
        message: `Section ${sectionId} (template ${templateId}, role ${role}) rendered with no text and no media at all`,
        sectionId,
        suggestion: "Copy substitution or photo resolution produced nothing for every slot in this section — check compose.ts's slot coverage for this template",
      });
    }

    if (text && UNDEFINED_LEAK_RE.test(` ${text} `)) {
      issues.push({
        severity: "hard",
        code: "UNDEFINED_LEAK",
        message: `Section ${sectionId} (template ${templateId}) shipped a literal "undefined"/"null"/"NaN" in its copy`,
        sectionId,
        suggestion: "An optional/missing field was interpolated without a guard — find the binding for this section and default it",
      });
    }

    // `$.html(node)` re-serializes just this section's subtree, so `scanHtmlForFillerLeaks` (and
    // its rawJson check) runs scoped to it — the leak gets this section's real id, not "somewhere
    // on the page".
    const leaks = scanHtmlForFillerLeaks($.html(node), businessName);
    for (const leak of leaks) {
      issues.push({
        severity: "hard",
        code: leak.code === "rawJson" ? "RAW_JSON_LEAK" : "TEMPLATE_FILLER_LEAK",
        message: `Section ${sectionId} (template ${templateId}): ${leak.code} leak at ${leak.selector}: "${leak.sample}"`,
        sectionId,
        suggestion:
          leak.code === "rawJson"
            ? "Guard whatever LLM copy step wrote this field against JSON-shaped output before splicing it in"
            : "Widen copy-slot coverage on the source template, or its filler-neutralization pass, for this shape",
      });
    }
  }
  return issues;
}

export interface CodeQAOptions {
  /**
   * `file://` URL of this page as written to disk. `page.setContent` leaves the document on
   * `about:blank`, which cannot load `file://` subresources at all — so a page that links external
   * stylesheets and images (verbatim-template output does) reports every one of them broken. When
   * a URL is supplied the page is really navigated to, which makes the asset checks meaningful.
   */
  pageUrl?: string;
  /** Tells `scanHtmlForFillerLeaks` this site's own already-substituted copyright credit apart from
   *  a genuinely leaked one — see that function's doc comment. Omitted, every page's own (correct)
   *  footer copyright line reads as a leak, unconditionally. */
  businessName?: string;
}

export async function runCodeQA(
  html: string,
  pageSlug: string,
  options: CodeQAOptions = {}
): Promise<QAResult> {
  return withQAMutex(() =>
    withTimeout(runCodeQAInner(html, pageSlug, options), QA_PAGE_TIMEOUT_MS, `QA for ${pageSlug}`)
  );
}

async function runCodeQAInner(
  html: string,
  pageSlug: string,
  options: CodeQAOptions = {}
): Promise<QAResult> {
  const issues: QAIssue[] = [];

  if (/\{"id":\s*"[^"]+",\s*"type":/.test(html)) {
    issues.push({
      severity: "hard",
      code: "RAW_JSON_LEAK",
      message: "Page HTML contains raw JSON block data",
      suggestion: "Normalize block types before render or add missing renderer cases",
    });
  }

  // Per-section structural check (filler/JSON leaks, empty sections, literal "undefined" leaks) —
  // see `validateSectionsStructurally`'s doc comment. This is the gate that was missing —
  // `compose.ts` tracked `slotsSkipped`/`fillerRewritten` as observability, but nothing failed the
  // build on a leftover "lorem ipsum", a JSON envelope, or a section that silently rendered empty.
  issues.push(...validateSectionsStructurally(html, options.businessName));

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
    if (options.pageUrl) {
      await page.goto(options.pageUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } else {
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
    }

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

    // Verbatim-template output never carries `[data-block-id]` (that marker is emitted only by the
    // classic block-composition renderer) — it wraps every section in `[data-tpl][data-section]`
    // instead (`templates/compose.ts`). Without this, the overflow check above silently matches zero
    // elements on 100% of verbatim pages, the default generation path, no matter how broken the
    // layout actually is. Same check, the marker this pipeline actually emits.
    const templateOverflowIssues = await page.evaluate((tolerance) => {
      const found: Array<{ templateId: string; sectionId: string }> = [];
      document.querySelectorAll<HTMLElement>("[data-tpl]").forEach((el) => {
        if (el.scrollWidth > el.clientWidth + tolerance) {
          found.push({
            templateId: el.dataset.tpl ?? "unknown",
            sectionId: el.dataset.section ?? "unknown",
          });
        }
      });
      return found;
    }, OVERFLOW_TOLERANCE_PX);

    for (const o of templateOverflowIssues) {
      issues.push({
        severity: "hard",
        code: "HORIZONTAL_OVERFLOW",
        message: `Overflow on section ${o.sectionId} (template ${o.templateId})`,
        targetId: o.sectionId,
        suggestion: "Re-ingest the source template, or widen its container CSS",
      });
    }

    // The defect real cross-template mixing can introduce and nothing else here checks for: a
    // section borrowed from a different source template rendering at a visibly different content
    // width or corner radius than its neighbor, so the page reads as two designs stitched together
    // rather than one site. `firstElementChild`'s own width is a coarse but effective proxy for "how
    // wide this section's own layout system rendered its main content row" — good enough to catch a
    // 940px container sitting next to a 1400px one, the actual "boxes don't line up" symptom.
    const templateMismatchIssues = await page.evaluate(() => {
      // NOTE: no named helper function declared in this callback, deliberately. Playwright sends
      // only this function's own serialized source into the browser's isolated evaluation context;
      // esbuild/tsx's name-preservation transform wraps a NAMED const/let function in a call to a
      // `__name(...)` helper it injects at the top of the compiled MODULE, not inside the function
      // itself — so a real `tsx`-run generation (not vitest, which transforms differently) threw
      // `ReferenceError: __name is not defined` the moment this evaluated in-browser. Confirmed
      // live. Every computation here stays inlined for exactly this reason.
      const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-tpl]"));
      const found: Array<{ a: string; b: string; templateA: string; templateB: string; widthA: number; widthB: number }> = [];
      for (let i = 1; i < sections.length; i += 1) {
        const prev = sections[i - 1]!;
        const cur = sections[i]!;
        const prevTpl = prev.dataset.tpl;
        const curTpl = cur.dataset.tpl;
        if (!prevTpl || !curTpl || prevTpl === curTpl) continue;
        // Chrome (nav/footer) intentionally always comes from one anchor template and is excluded
        // from this comparison on purpose — it never legitimately differs from a content section.
        if (cur.dataset.role === "nav" || cur.dataset.role === "footer") continue;
        const prevChild = prev.firstElementChild as HTMLElement | null;
        const curChild = cur.firstElementChild as HTMLElement | null;
        const widthA = (prevChild ?? prev).getBoundingClientRect().width;
        const widthB = (curChild ?? cur).getBoundingClientRect().width;
        if (widthA < 100 || widthB < 100) continue; // hidden/collapsed section — not a real signal
        const ratio = Math.max(widthA, widthB) / Math.min(widthA, widthB);
        if (ratio > 1.2) {
          found.push({
            a: prev.dataset.section ?? "unknown",
            b: cur.dataset.section ?? "unknown",
            templateA: prevTpl,
            templateB: curTpl,
            widthA: Math.round(widthA),
            widthB: Math.round(widthB),
          });
        }
      }
      return found;
    });

    for (const m of templateMismatchIssues) {
      issues.push({
        severity: "hard",
        code: "CROSS_TEMPLATE_WIDTH_MISMATCH",
        message:
          `Section ${m.b} (template ${m.templateB}, ${m.widthB}px content) sits directly under ` +
          `${m.a} (template ${m.templateA}, ${m.widthA}px content) — mismatched container widths ` +
          `from mixing source templates`,
        targetId: m.b,
        suggestion: "Lower TEMPLATE_MIX_COMPATIBILITY_THRESHOLD's effect by re-scoring this pairing, or exclude it from mixing",
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

    // Was `img[src]` + an early `if (!src) return` — an `<img>` with no `src` at all, or `src=""`
    // (a stock/photo-slot resolution that silently failed and left the attribute blank instead of
    // populating it), never matched that selector and was never flagged: the literal "empty image"
    // this repo's own generations have shipped. Now checked as its own case, distinct from a real
    // hotlink that 404s or times out.
    const { broken: brokenImages, empty: emptyImages } = await page.evaluate(() => {
      const broken: string[] = [];
      const empty: string[] = [];
      document.querySelectorAll("img").forEach((img) => {
        const el = img as HTMLImageElement;
        const parent = el.closest("[data-block-id]") as HTMLElement | null;
        const label = parent?.dataset.blockId ?? "image";
        const src = el.getAttribute("src")?.trim() ?? "";
        if (!src) {
          empty.push(label);
          return;
        }
        if (src.startsWith("data:")) return;
        if (!el.complete || el.naturalWidth === 0) broken.push(label);
      });
      return { broken, empty };
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
    for (const id of emptyImages) {
      issues.push({
        severity: "hard",
        code: "EMPTY_IMAGE",
        message: `Image in block ${id} has no src at all (never resolved)`,
        targetId: id,
        suggestion: "Photo/media resolution silently failed for this slot — investigate the resolver, don't just clear src again",
      });
    }

    await page.close();

    // Mobile viewport pass (390px). Same `pageUrl` requirement as the desktop pass above: a page
    // with external stylesheets (verbatim-template output always does) measured via `setContent`
    // has no base URL to resolve them against, so every measurement below would run against
    // unstyled content — silently useless rather than merely inaccurate.
    const mobilePage = await browser.newPage();
    await mobilePage.setViewportSize({ width: 390, height: 844 });
    if (options.pageUrl) {
      await mobilePage.goto(options.pageUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } else {
      await mobilePage.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
    }

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

    const templateMobileOverflow = await mobilePage.evaluate((tolerance) => {
      const found: Array<{ templateId: string; sectionId: string }> = [];
      document.querySelectorAll<HTMLElement>("[data-tpl]").forEach((el) => {
        if (el.scrollWidth > el.clientWidth + tolerance) {
          found.push({ templateId: el.dataset.tpl ?? "unknown", sectionId: el.dataset.section ?? "unknown" });
        }
      });
      return found;
    }, OVERFLOW_TOLERANCE_PX);

    for (const o of templateMobileOverflow) {
      issues.push({
        severity: "soft",
        code: "MOBILE_OVERFLOW",
        message: `Mobile horizontal overflow on section ${o.sectionId} (template ${o.templateId})`,
        targetId: o.sectionId,
        suggestion: "Stack columns on narrow viewports",
      });
    }

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

/**
 * The verbatim-template counterpart to `extractBlockManifestFromUrl` — grounds the final vision
 * judge (`final-vision-gate.ts`) in real per-section structural data instead of an empty manifest,
 * which is otherwise its only structural signal for the pipeline's default generation path. Must be
 * called against a live served URL (same reasoning as `CodeQAOptions.pageUrl`): the CSS these
 * measurements depend on will not load via `page.setContent`.
 */
export async function extractTemplateSectionManifestFromUrl(url: string): Promise<BlockManifestEntry[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
  const manifest = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-tpl]")).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.section ?? "unknown",
        type: el.dataset.role ?? "section",
        top: Math.round(r.top),
        height: Math.round(r.height),
        width: Math.round(r.width),
        sectionId: el.dataset.section,
        templateId: el.dataset.tpl,
      };
    });
  });
  await page.close();
  return manifest;
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

/**
 * URL-based variants for the React static-export pipeline, whose HTML references CSS/JS via
 * root-relative paths (e.g. "/preview/_next/static/..."). page.setContent() has no base URL to
 * resolve those against, so it silently renders with zero styling — these navigate to a real
 * served URL instead, matching how a browser actually loads the page.
 */
// Not routed through withQAMutex — these navigate independent pages/contexts against a real
// served URL rather than mutating a single page's content, so concurrent callers are safe
// (Playwright supports many concurrent pages per browser instance). Callers should still bound
// their own concurrency (e.g. via mapPool) to avoid launching an unbounded number of pages at
// once for very large sites.
export async function extractBlockManifestFromUrl(url: string): Promise<BlockManifestEntry[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
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
}

export async function screenshotUrlDual(url: string): Promise<ViewportScreenshots> {
  return withTimeout(screenshotUrlDualInner(url), QA_PAGE_TIMEOUT_MS, "dual screenshot");
}

async function screenshotUrlDualInner(url: string): Promise<ViewportScreenshots> {
  const browser = await getBrowser();

  const [desktop, mobile] = await Promise.all([
    (async () => {
      const desktopPage = await browser.newPage();
      await desktopPage.setViewportSize({ width: 1280, height: 800 });
      await desktopPage.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
      const shot = (await desktopPage.screenshot({ fullPage: true, type: "png" })).toString("base64");
      await desktopPage.close();
      return shot;
    })(),
    (async () => {
      const mobilePage = await browser.newPage();
      await mobilePage.setViewportSize({ width: 390, height: 844 });
      await mobilePage.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
      const shot = (await mobilePage.screenshot({ fullPage: true, type: "png" })).toString("base64");
      await mobilePage.close();
      return shot;
    })(),
  ]);

  return { desktop, mobile };
}
