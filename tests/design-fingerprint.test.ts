import { describe, expect, it } from "vitest";
import {
  extractDesignFingerprint,
  fingerprintCompatibility,
  radiusScaleForPx,
  spacingScaleForPx,
} from "../src/templates/ingest/design-fingerprint.js";
import { restyleCss } from "../src/templates/ingest/restyle-css.js";
import type { DesignFingerprint } from "../src/templates/types.js";

function fp(overrides: Partial<DesignFingerprint>): DesignFingerprint {
  return { containerMaxWidthPx: 1200, radiusPx: 8, radiusScale: "soft", spacingScale: "normal", ...overrides };
}

describe("extractDesignFingerprint", () => {
  it("reads a sharp-cornered, narrow-container template's own numbers", () => {
    const css = `
      .container { max-width: 960px; margin: 0 auto; }
      .card { border-radius: 2px; padding: 16px; }
      .btn { border-radius: 3px; }
    `;
    const out = extractDesignFingerprint(css);
    expect(out.containerMaxWidthPx).toBe(960);
    expect(out.radiusScale).toBe("sharp");
  });

  it("treats a 50%/9999px button radius as pill, weighted toward button-ish selectors", () => {
    const css = `
      .card { border-radius: 4px; }
      .btn-primary { border-radius: 9999px; padding: 12px 24px; }
    `;
    const out = extractDesignFingerprint(css);
    expect(out.radiusScale).toBe("pill");
  });

  it("converts rem to px for both container width and radius", () => {
    const css = `.wrapper { max-width: 71.25rem; } .btn { border-radius: 1.25rem; }`;
    const out = extractDesignFingerprint(css);
    expect(out.containerMaxWidthPx).toBe(1140); // 71.25 * 16
    expect(out.radiusScale).toBe("rounded"); // 20px
  });

  it("ignores an unrelated small max-width (e.g. an icon wrapper) that is not container-shaped", () => {
    const css = `.icon-wrap { max-width: 40px; }`;
    const out = extractDesignFingerprint(css);
    // Nothing container-shaped or in the common container range was found — default.
    expect(out.containerMaxWidthPx).toBe(1200);
  });

  it("never throws on CSS the tolerant parser still can't fully make sense of", () => {
    expect(() => extractDesignFingerprint("***/ { not css at all")).not.toThrow();
  });

  it("bucket helpers agree with extraction's own thresholds", () => {
    expect(radiusScaleForPx(2)).toBe("sharp");
    expect(radiusScaleForPx(10)).toBe("soft");
    expect(radiusScaleForPx(20)).toBe("rounded");
    expect(radiusScaleForPx(999)).toBe("pill");
    expect(spacingScaleForPx(10)).toBe("tight");
    expect(spacingScaleForPx(24)).toBe("normal");
    expect(spacingScaleForPx(60)).toBe("loose");
  });
});

describe("fingerprintCompatibility", () => {
  it("scores an identical fingerprint as fully compatible", () => {
    const a = fp({});
    expect(fingerprintCompatibility(a, { ...a })).toBe(1);
  });

  it("scores a wildly different container width and radius bucket as incompatible", () => {
    const anchor = fp({ containerMaxWidthPx: 940, radiusScale: "sharp" });
    const candidate = fp({ containerMaxWidthPx: 1600, radiusScale: "pill" });
    expect(fingerprintCompatibility(anchor, candidate)).toBeLessThan(0.4);
  });

  it("scores adjacent radius buckets higher than opposite ones", () => {
    const anchor = fp({ radiusScale: "soft" });
    const adjacent = fingerprintCompatibility(anchor, fp({ radiusScale: "rounded" }));
    const opposite = fingerprintCompatibility(anchor, fp({ radiusScale: "pill" }));
    expect(adjacent).toBeGreaterThan(opposite);
  });

  it("defaults to 0 (never mixes) when either fingerprint is missing", () => {
    expect(fingerprintCompatibility(undefined, fp({}))).toBe(0);
    expect(fingerprintCompatibility(fp({}), undefined)).toBe(0);
  });
});

describe("restyleCss", () => {
  it("is a no-op when source and target already read the same", () => {
    const css = ".btn { border-radius: 4px; }";
    const same = fp({});
    const out = restyleCss(css, same, same);
    expect(out.css).toBe(css);
    expect(out.stats.radiusRewritten).toBe(0);
  });

  it("snaps a sharp source radius to the target's representative pill value, not a proportional scale", () => {
    const css = ".btn { border-radius: 2px; }";
    const out = restyleCss(css, fp({ radiusScale: "sharp" }), fp({ radiusScale: "pill" }));
    expect(out.css).toContain("border-radius: 9999px");
    expect(out.stats.radiusRewritten).toBe(1);
  });

  it("remaps a multi-value shorthand's non-zero corners together, leaving a genuine 0 corner sharp", () => {
    const css = ".card { border-radius: 4px 4px 0 0; }";
    const out = restyleCss(css, fp({ radiusScale: "sharp" }), fp({ radiusScale: "rounded" }));
    expect(out.css).toContain("border-radius: 20px 20px 0 0");
  });

  it("rewrites a container max-width close to the source's own measured width, not an unrelated one", () => {
    const css = ".container { max-width: 960px; } .icon { max-width: 32px; }";
    const out = restyleCss(
      css,
      fp({ containerMaxWidthPx: 960 }),
      fp({ containerMaxWidthPx: 1320 })
    );
    expect(out.css).toContain("max-width: 1320px");
    expect(out.css).toContain("max-width: 32px"); // untouched — not close to the source's own 960px
  });

  it("leaves container width alone when source and target are already close", () => {
    const css = ".container { max-width: 1190px; }";
    const out = restyleCss(css, fp({ containerMaxWidthPx: 1190 }), fp({ containerMaxWidthPx: 1200 }));
    expect(out.css).toContain("max-width: 1190px");
    expect(out.stats.containerRewritten).toBe(0);
  });

  it("never throws on unparseable CSS — ships the section unrestyled rather than broken", () => {
    const css = "***/ not real css";
    const out = restyleCss(css, fp({ radiusScale: "sharp" }), fp({ radiusScale: "pill" }));
    expect(out.css).toBe(css);
  });
});
