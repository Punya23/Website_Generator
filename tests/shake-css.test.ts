import { describe, expect, it } from "vitest";
import { collectMarkupTokens, shakeCss } from "../src/templates/ingest/shake-css.js";

const scope = `[data-tpl="tpl_x"]`;

function shake(css: string, html: string): string {
  return shakeCss(css, collectMarkupTokens(html)).css;
}

describe("shake-css", () => {
  it("keeps rules the markup can match and drops the rest", () => {
    const css = `
      ${scope} .hero { color: red }
      ${scope} .pricing-table { color: blue }
      ${scope} h1 { font-size: 3rem }
      ${scope} .blog-sidebar h4 { margin: 0 }
    `;
    const out = shake(css, `<div class="hero"><h1>Hi</h1></div>`);
    expect(out).toContain(".hero");
    expect(out).toContain("h1");
    expect(out).not.toContain("pricing-table");
    expect(out).not.toContain("blog-sidebar");
  });

  it("rewrites a comma list down to only the selectors that survive", () => {
    const css = `${scope} .hero, ${scope} .team-card, ${scope} .price-box { padding: 1rem }`;
    const out = shake(css, `<div class="hero"></div>`);
    expect(out).toContain(".hero");
    expect(out).not.toContain("team-card");
    expect(out).not.toContain("price-box");
  });

  it("requires every part of a descendant selector, not just one", () => {
    const css = `${scope} .card .avatar { border-radius: 50% }`;
    // `.card` is present, `.avatar` is not — the rule can never match.
    expect(shake(css, `<div class="card"></div>`)).not.toContain("avatar");
  });

  it("never treats a :not()/:is() argument as a requirement", () => {
    const css = `
      ${scope} .hero:not(.compact) { padding: 4rem }
      ${scope} :is(.hero, .banner) h2 { margin: 0 }
    `;
    const out = shake(css, `<div class="hero"><h2>t</h2></div>`);
    // `.compact` and `.banner` are absent, but neither is a reason to drop these rules.
    expect(out).toContain(":not(.compact)");
    expect(out).toContain(":is(.hero, .banner)");
  });

  it("matches attribute selectors on the attribute name only", () => {
    const css = `
      ${scope} [class*='logo'] { width: 120px }
      ${scope} [data-carousel] { display: flex }
    `;
    const out = shake(css, `<div class="brand-logo"></div>`);
    expect(out).toContain("[class*='logo']");
    expect(out).not.toContain("data-carousel");
  });

  it("keeps the scope-root rule that carries the template's custom properties", () => {
    // `:root`/`body` were rewritten to the bare scope attribute during ingest scoping.
    const css = `${scope} { --thm-base: #fff; background: #000 }`;
    const out = shake(css, `<div class="hero"></div>`);
    expect(out).toContain("--thm-base");
  });

  it("drops @keyframes nothing animates any more, keeps the ones still referenced", () => {
    const css = `
      ${scope} .hero { animation: tpl_x__fadeIn 1s }
      @keyframes tpl_x__fadeIn { from { opacity: 0 } to { opacity: 1 } }
      ${scope} .slider-dot { animation: tpl_x__spin 2s }
      @keyframes tpl_x__spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
    `;
    const out = shake(css, `<div class="hero"></div>`);
    expect(out).toContain("tpl_x__fadeIn");
    expect(out).not.toContain("tpl_x__spin");
  });

  it("drops an @font-face whose family nothing uses, keeps one still referenced", () => {
    const css = `
      @font-face { font-family: "icomoon"; src: url(a.woff2) }
      @font-face { font-family: "Unused Display"; src: url(b.woff2) }
      ${scope} .icon { font-family: "icomoon" }
    `;
    const out = shake(css, `<i class="icon"></i>`);
    expect(out).toContain("icomoon");
    expect(out).not.toContain("Unused Display");
  });

  it("shakes inside @media and removes the block when it empties", () => {
    const css = `
      @media (max-width: 768px) {
        ${scope} .hero { font-size: 2rem }
        ${scope} .shop-grid { display: none }
      }
      @media print { ${scope} .invoice-table { display: block } }
    `;
    const out = shake(css, `<div class="hero"></div>`);
    expect(out).toContain("max-width: 768px");
    expect(out).toContain(".hero");
    expect(out).not.toContain("shop-grid");
    expect(out).not.toContain("@media print");
  });

  it("keeps a rule whose selector cannot be parsed rather than losing it", () => {
    // Confirmed real: an unbalanced comment in a bundle template leaves `***/ .animation1` behind.
    const css = `***/ .animation1 { opacity: 1 } ${scope} .hero { color: red }`;
    const out = shake(css, `<div class="hero"></div>`);
    expect(out).toContain("animation1");
  });

  it("collects tokens across several sections sharing one stylesheet", () => {
    const tokens = collectMarkupTokens(`<div class="hero"></div>`);
    collectMarkupTokens(`<footer class="site-footer"><a id="top"></a></footer>`, tokens);
    expect(tokens.classes.has("hero")).toBe(true);
    expect(tokens.classes.has("site-footer")).toBe(true);
    expect(tokens.ids.has("top")).toBe(true);
    expect(tokens.tags.has("footer")).toBe(true);
  });

  it("reports how much it removed", () => {
    const css = `${scope} .hero{color:red} ${scope} .gone{color:blue} ${scope} .also-gone{color:green}`;
    const result = shakeCss(css, collectMarkupTokens(`<div class="hero"></div>`));
    expect(result.rulesKept).toBe(1);
    expect(result.rulesDropped).toBe(2);
  });
});
