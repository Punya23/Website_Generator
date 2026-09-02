import { describe, expect, it, afterEach, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  captureThemeFeatures,
  deriveDensity,
  deriveFooterLayout,
  deriveNavShape,
  deriveThemeFeatures,
  deriveVisualFamily,
  hue,
  luminance,
  parseCssColor,
  pickAccent,
  normalizeMetrics,
  pruneThumbnails,
  readMetricsSource,
  readThumbnail,
  resetCaptureQueue,
  saturation,
  thumbnailNameFor,
  withCaptureSlot,
  type RawPageMetrics,
} from "../src/admin/theme-features.js";
import { screenshotDecision } from "../src/admin/pipeline.js";
import { mapOutlineWithLlm } from "../src/admin/llm-map-recipe.js";
import type { IngestCandidate, ThemeFeatures } from "../src/admin/types.js";

function metrics(overrides: Partial<RawPageMetrics> = {}): RawPageMetrics {
  return {
    viewportWidth: 1280,
    bodyBackground: "rgb(255, 255, 255)",
    bodyColor: "rgb(20, 20, 20)",
    headingFont: "Inter, sans-serif",
    bodyFont: "Inter, sans-serif",
    accentColors: [],
    nav: {
      found: true,
      position: "static",
      width: 1280,
      left: 0,
      top: 0,
      height: 72,
      borderRadius: 0,
      background: "rgb(255, 255, 255)",
      logoCenterRatio: 0.08,
      linkGroups: 1,
    },
    footer: { found: true, columns: 3, ctaButtons: 0, textAlign: "left" },
    sectionPaddings: [64, 72, 68],
    headingCount: 9,
    imageCount: 6,
    documentHeight: 4200,
    ...overrides,
  };
}

function candidate(overrides: Partial<IngestCandidate> = {}): IngestCandidate {
  return {
    id: "c1",
    sourceId: "s1",
    title: "Theme",
    originUrl: "https://github.com/owner/theme",
    demoUrl: "https://owner.github.io/theme/",
    licenseDetected: "MIT",
    licenseOk: true,
    status: "verifying",
    events: [],
    createdAt: 1,
    updatedAt: 1,
    outline: {
      title: "Theme",
      headings: [
        { level: 1, text: "Welcome" },
        { level: 2, text: "Our services" },
        { level: 2, text: "Testimonials" },
        { level: 2, text: "Get started" },
      ],
      landmarks: ["hero", "features", "testimonials", "cta"],
    },
    ...overrides,
  };
}

describe("colour helpers", () => {
  it("parses rgb, rgba and hex", () => {
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor("#0a141e")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
  });

  it("measures luminance, saturation and hue", () => {
    expect(luminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 3);
    expect(luminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 3);
    expect(saturation({ r: 128, g: 128, b: 128, a: 1 })).toBe(0);
    expect(saturation({ r: 255, g: 0, b: 0, a: 1 })).toBe(1);
    expect(hue({ r: 255, g: 0, b: 0, a: 1 })).toBe(0);
    expect(hue({ r: 0, g: 0, b: 255, a: 1 })).toBeCloseTo(240, 0);
  });

  it("skips neutral, transparent and near-white candidates when picking an accent", () => {
    const accent = pickAccent([
      "rgba(0, 0, 0, 0)",
      "rgb(250, 250, 250)",
      "rgb(120, 120, 122)",
      "rgb(20, 90, 200)",
    ]);
    expect(accent).toEqual({ r: 20, g: 90, b: 200, a: 1 });
    expect(pickAccent(["rgb(255,255,255)", "rgb(17,17,17)"])).toBeNull();
  });
});

describe("visual family derivation", () => {
  it("reads a dark page as luxury-dark", () => {
    const result = deriveVisualFamily(metrics({ bodyBackground: "rgb(12, 12, 16)" }));
    expect(result).toEqual({ visualFamily: "luxury-dark", confident: true });
  });

  it("reads a warm saturated accent as warm-consumer", () => {
    const result = deriveVisualFamily(metrics({ accentColors: ["rgb(230, 120, 30)"] }));
    expect(result.visualFamily).toBe("warm-consumer");
    expect(result.confident).toBe(true);
  });

  it("reads a desaturated accent as clinical-light", () => {
    const result = deriveVisualFamily(metrics({ accentColors: ["rgb(150, 165, 175)"] }));
    expect(result.visualFamily).toBe("clinical-light");
  });

  it("reads serif headings as editorial-light", () => {
    const result = deriveVisualFamily(
      metrics({ headingFont: '"Playfair Display", Georgia, serif' })
    );
    expect(result).toEqual({ visualFamily: "editorial-light", confident: true });
  });

  it("falls back to corporate-light for a plain sans page with a cool accent", () => {
    const result = deriveVisualFamily(metrics({ accentColors: ["rgb(30, 90, 220)"] }));
    expect(result.visualFamily).toBe("corporate-light");
  });

  it("is not confident when the body background is transparent", () => {
    const result = deriveVisualFamily(metrics({ bodyBackground: "rgba(0, 0, 0, 0)" }));
    expect(result.confident).toBe(false);
  });
});

describe("chrome derivation", () => {
  it("classifies a fixed, inset, rounded bar as a floating capsule", () => {
    const result = deriveNavShape(
      metrics({
        nav: { ...metrics().nav, position: "fixed", left: 40, width: 1100, borderRadius: 999, height: 64 },
      })
    );
    expect(result).toEqual({ navShape: "floating-capsule", confident: true });
  });

  it("classifies a tall floating bar as a panel", () => {
    const result = deriveNavShape(
      metrics({
        nav: { ...metrics().nav, position: "fixed", left: 40, width: 1100, borderRadius: 32, height: 120 },
      })
    );
    expect(result.navShape).toBe("floating-panel");
  });

  it("classifies a centred logo with link groups either side as split-inline", () => {
    const result = deriveNavShape(
      metrics({ nav: { ...metrics().nav, logoCenterRatio: 0.5, linkGroups: 2 } })
    );
    expect(result.navShape).toBe("split-inline");
  });

  it("defaults to full-width and reports no confidence without a nav", () => {
    expect(deriveNavShape(metrics()).navShape).toBe("full-width");
    expect(deriveNavShape(metrics({ nav: { ...metrics().nav, found: false } })).confident).toBe(false);
  });

  it("classifies footers", () => {
    expect(deriveFooterLayout(metrics()).footerLayout).toBe("two-column");
    expect(
      deriveFooterLayout(metrics({ footer: { found: true, columns: 1, ctaButtons: 2, textAlign: "left" } }))
        .footerLayout
    ).toBe("cta-heavy");
    expect(
      deriveFooterLayout(metrics({ footer: { found: true, columns: 1, ctaButtons: 0, textAlign: "center" } }))
        .footerLayout
    ).toBe("centered");
    expect(deriveFooterLayout(metrics({ footer: { found: false, columns: 0, ctaButtons: 0, textAlign: "left" } })).confident).toBe(false);
  });

  it("classifies density from median section padding", () => {
    expect(deriveDensity(metrics({ sectionPaddings: [120, 140, 110] }))).toBe("airy");
    expect(deriveDensity(metrics({ sectionPaddings: [24, 30, 36] }))).toBe("compact");
    expect(deriveDensity(metrics({ sectionPaddings: [] }))).toBe("normal");
  });
});

describe("feature record", () => {
  it("marks a fully measured page conclusive", () => {
    const features = deriveThemeFeatures(
      metrics({
        bodyBackground: "rgb(10, 10, 14)",
        accentColors: ["rgb(220, 180, 90)"],
        nav: { ...metrics().nav, position: "fixed", left: 40, width: 1100, borderRadius: 999 },
      }),
      { capturedAt: 5, sourceUrl: "https://owner.github.io/theme/" }
    );
    expect(features.conclusive).toBe(true);
    expect(features.dark).toBe(true);
    expect(features.visualFamily).toBe("luxury-dark");
    expect(features.backgroundHex).toBe("#0a0a0e");
    expect(features.accentHex).toBe("#dcb45a");
    expect(features.capturedAt).toBe(5);
  });

  it("is inconclusive when the page hid its ground colour", () => {
    const features = deriveThemeFeatures(metrics({ bodyBackground: "rgba(0,0,0,0)" }), {
      capturedAt: 1,
      sourceUrl: "https://x.test/",
    });
    expect(features.conclusive).toBe(false);
  });
});

describe("in-page metrics script", () => {
  // The loader (esbuild via tsx) wraps named functions in a `__name` keep-names helper that does
  // not exist inside the page, so a function handed to page.evaluate dies with
  // "ReferenceError: __name is not defined" only after bundling. Keeping the script as a source
  // string is the fix; this test is the guard that it stays one.
  it("carries no bundler helper references", () => {
    const source = readMetricsSource();
    expect(source).not.toMatch(/__name|__publicField|__defProp|__toESM/);
    expect(source.startsWith("(() => {")).toBe(true);
  });

  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(`return ${readMetricsSource()};`)).not.toThrow();
  });

  it("normalizes a partial or hostile result instead of producing NaN", () => {
    const normalized = normalizeMetrics({
      viewportWidth: "wide",
      accentColors: ["rgb(1,2,3)", 42, null],
      nav: { found: true, width: Number.NaN, position: 7 },
      sectionPaddings: [40, "x"],
    });
    expect(normalized.viewportWidth).toBe(0);
    expect(normalized.accentColors).toEqual(["rgb(1,2,3)"]);
    expect(normalized.nav.width).toBe(0);
    expect(normalized.nav.position).toBe("static");
    expect(normalized.sectionPaddings).toEqual([40, 0]);
    expect(normalized.footer.found).toBe(false);
    expect(Object.values(normalized).every((value) => value !== undefined)).toBe(true);
  });

  it("survives an empty result object", () => {
    const normalized = normalizeMetrics(undefined);
    expect(normalized.headingCount).toBe(0);
    expect(() => deriveThemeFeatures(normalized, { capturedAt: 1, sourceUrl: "x" })).not.toThrow();
    expect(deriveThemeFeatures(normalized, { capturedAt: 1, sourceUrl: "x" }).conclusive).toBe(false);
  });
});

describe("thumbnail storage", () => {
  const prevDir = process.env.INGEST_THUMBS_DIR;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-thumbs-"));
    process.env.INGEST_THUMBS_DIR = dir;
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env.INGEST_THUMBS_DIR;
    else process.env.INGEST_THUMBS_DIR = prevDir;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads a stored thumbnail by its hash name", async () => {
    const name = thumbnailNameFor("https://owner.github.io/theme/");
    expect(name).toMatch(/^[0-9a-f]{40}\.jpg$/);
    await fs.writeFile(path.join(dir, name), Buffer.from("jpegbytes"));
    expect((await readThumbnail(name))?.toString()).toBe("jpegbytes");
  });

  it("prunes only unreferenced hash-named files", async () => {
    const keptName = thumbnailNameFor("https://a.test/");
    const staleName = thumbnailNameFor("https://b.test/");
    await fs.writeFile(path.join(dir, keptName), Buffer.from("keep"));
    await fs.writeFile(path.join(dir, staleName), Buffer.from("stale"));
    await fs.writeFile(path.join(dir, "notes.txt"), Buffer.from("unrelated"));

    expect(await pruneThumbnails(new Set([keptName]))).toBe(1);
    expect(await readThumbnail(keptName)).not.toBeNull();
    expect(await readThumbnail(staleName)).toBeNull();
    expect((await fs.readdir(dir)).sort()).toEqual([keptName, "notes.txt"].sort());
  });

  it("refuses any name that is not a bare hash", async () => {
    await fs.writeFile(path.join(dir, "secret.jpg"), Buffer.from("x"));
    expect(await readThumbnail("../../.env")).toBeNull();
    expect(await readThumbnail("secret.jpg")).toBeNull();
    expect(await readThumbnail(`${"a".repeat(40)}.png`)).toBeNull();
    expect(await readThumbnail(`/etc/${"a".repeat(40)}.jpg`)).toBeNull();
  });
});

describe("capture concurrency", () => {
  const prev = process.env.INGEST_SCREENSHOT_CONCURRENCY;

  afterEach(() => {
    if (prev === undefined) delete process.env.INGEST_SCREENSHOT_CONCURRENCY;
    else process.env.INGEST_SCREENSHOT_CONCURRENCY = prev;
    resetCaptureQueue();
  });

  it("never runs more renders at once than the configured limit", async () => {
    process.env.INGEST_SCREENSHOT_CONCURRENCY = "2";
    resetCaptureQueue();
    let active = 0;
    let peak = 0;
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withCaptureSlot(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push(i);
          active -= 1;
        })
      )
    );

    expect(peak).toBe(2);
    expect(order).toHaveLength(8);
    expect(active).toBe(0);
  });

  it("releases the slot when the task throws, so later renders still run", async () => {
    process.env.INGEST_SCREENSHOT_CONCURRENCY = "1";
    resetCaptureQueue();
    await expect(
      withCaptureSlot(async () => {
        throw new Error("render blew up");
      })
    ).rejects.toThrow("render blew up");

    await expect(withCaptureSlot(async () => "ok")).resolves.toBe("ok");
  });
});

describe("capture gating", () => {
  it("captures only when a render changes an outcome", () => {
    expect(screenshotDecision(candidate(), { mode: "needed" }).capture).toBe(true);

    expect(screenshotDecision(candidate(), { mode: "never" })).toEqual({
      capture: false,
      reason: "screenshots disabled",
    });
    expect(screenshotDecision(candidate({ demoUrl: undefined }), { mode: "needed" }).capture).toBe(false);
    expect(screenshotDecision(candidate({ licenseOk: false }), { mode: "needed" }).reason).toMatch(
      /license not verified/
    );
    expect(
      screenshotDecision(candidate({ outline: { title: "t", headings: [], landmarks: [] } }), {
        mode: "needed",
      }).capture
    ).toBe(false);
  });

  it("does not re-render a demo whose features are already measured", () => {
    const measured = candidate({
      features: {
        capturedAt: 1,
        sourceUrl: "https://owner.github.io/theme/",
        visualFamily: "luxury-dark",
        navShape: "full-width",
        footerLayout: "two-column",
        density: "normal",
        dark: true,
        serifHeadings: false,
        headingCount: 4,
        imageCount: 2,
        conclusive: true,
      },
    });
    expect(screenshotDecision(measured, { mode: "needed" }).reason).toMatch(/already measured/);
    // A different demo URL is a different render.
    expect(
      screenshotDecision(candidate({ ...measured, demoUrl: "https://owner.github.io/other/" }), {
        mode: "needed",
      }).capture
    ).toBe(true);
  });

  it("still captures a weak composition under always, never under never", () => {
    const weak = candidate({ outline: { title: "t", headings: [{ level: 1, text: "Hi" }], landmarks: [] } });
    expect(screenshotDecision(weak, { mode: "needed" }).capture).toBe(false);
    expect(screenshotDecision(weak, { mode: "always" }).capture).toBe(true);
    expect(screenshotDecision(weak, { mode: "never" }).capture).toBe(false);
  });

  it("refuses to launch a browser without a verified license", async () => {
    const result = await captureThemeFeatures("https://owner.github.io/theme/", {
      licenseVerified: false,
      originUrl: "https://github.com/owner/theme",
    });
    expect(result.features).toBeUndefined();
    expect(result.skipped).toMatch(/license not verified|screenshots disabled/);
  });

  it("refuses a blocked host even with a verified license", async () => {
    const prev = process.env.INGEST_SCREENSHOT;
    process.env.INGEST_SCREENSHOT = "always";
    try {
      const result = await captureThemeFeatures("https://framer.com/theme", {
        licenseVerified: true,
        originUrl: "https://github.com/owner/theme",
      });
      expect(result.features).toBeUndefined();
      expect(result.skipped).toMatch(/not an allowed ingest source/i);
    } finally {
      if (prev === undefined) delete process.env.INGEST_SCREENSHOT;
      else process.env.INGEST_SCREENSHOT = prev;
    }
  });
});

describe("mapping with measured features", () => {
  const features: ThemeFeatures = {
    capturedAt: 1,
    sourceUrl: "https://owner.github.io/theme/",
    visualFamily: "luxury-dark",
    navShape: "floating-capsule",
    footerLayout: "cta-heavy",
    density: "airy",
    dark: true,
    serifHeadings: true,
    headingCount: 8,
    imageCount: 4,
    conclusive: true,
  };

  it("takes visual attributes from the render and skips the LLM", async () => {
    const mapped = await mapOutlineWithLlm({
      outline: candidate().outline!,
      category: "creative",
      features,
    });
    expect(mapped.usedLlm).toBe(false);
    expect(mapped.usedFeatures).toBe(true);
    expect(mapped.visualFamily).toBe("luxury-dark");
    expect(mapped.navShape).toBe("floating-capsule");
    expect(mapped.footerLayout).toBe("cta-heavy");
    expect(mapped.recipe.confidence).toBeGreaterThanOrEqual(0.75);
    expect(mapped.recipe.notes.join(" ")).toMatch(/measured/);
  });

  it("falls back to defaults with no features at all", async () => {
    const mapped = await mapOutlineWithLlm({ outline: candidate().outline!, category: "creative" });
    expect(mapped.usedFeatures).toBe(false);
    expect(mapped.visualFamily).toBe("editorial-light");
  });

  it("still uses inconclusive measurements rather than guessing", async () => {
    const mapped = await mapOutlineWithLlm({
      outline: candidate().outline!,
      category: "creative",
      features: { ...features, conclusive: false },
    });
    expect(mapped.usedFeatures).toBe(true);
    expect(mapped.visualFamily).toBe("luxury-dark");
  });
});
