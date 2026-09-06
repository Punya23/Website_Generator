/**
 * Placed sections -> complete HTML pages.
 *
 * Each section keeps its own markup and its own (scoped, recolored) stylesheet; this module only
 * wraps, links and orders them, rewrites navigation to the generated page set, and emits the list
 * of files the output writer must copy.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { ExpandedBrief } from "../types.js";
import {
  anchorEditableText,
  applyCopySlots,
  applyPhotoSlots,
  createCopyRunState,
  resolveContact,
  type CopyChange,
} from "./copy-slots.js";
import { templateCachePath } from "./ingest/ingest-template.js";
import { collectMarkupTokens, emptyTokens, shakeCss, type MarkupTokens } from "./ingest/shake-css.js";
import { restyleCss } from "./ingest/restyle-css.js";
import { getPalette } from "./palette.js";
import { templateCssShakeEnabled, templatePaletteId } from "./config.js";
import { templateStore, type TemplateStore } from "./store.js";
import type { DesignFingerprint, PlacedSection, TemplateManifest } from "./types.js";
import { classifyBriefTaxonomy } from "../skins/picker.js";
import { stockImageUrl } from "../media/stock-images.js";
import { resolveUniqueImage } from "../media/enrich-content.js";
import type { MediaRegistry } from "../media/media-registry.js";
import { curateVerbatimPhotoQueries } from "../agents/verbatim-media-agent.js";

/**
 * CSS files sit at the site root, next to the HTML pages — NOT in a subfolder. A stylesheet's own
 * `url(...)` references resolve relative to *its own* location, and asset paths were computed
 * relative to the template root (i.e. the site root, same as the HTML). Putting the CSS one level
 * down broke every relative asset/@import/@font-face reference inside it (confirmed live: vendor
 * CSS pulled in via @import, and embedded webfont files, 404'd as `_tpl-css/_tpl-assets/...`).
 */
export const TEMPLATE_CSS_ROOT = "";

/**
 * One font, site-wide. Sections keep their own markup and colors verbatim, but typography is the
 * one thing composing from N different source templates cannot leave alone: each template ships
 * its own `font-family` declarations (often several, at high specificity) for its own headings,
 * body copy and buttons, so a page mixing sections from different templates renders with 2-3
 * competing typefaces. Every real text element is forced onto this stack; icon glyphs (rendered
 * via `<i class="fa...">`-style icon fonts, never listed among the overridden tags below) are
 * untouched, since forcing their font-family would turn every icon into a literal letter.
 */
const SITE_FONT_FAMILY = "Inter";
const SITE_FONT_STACK = `"${SITE_FONT_FAMILY}", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const SITE_FONT_LINK =
  `https://fonts.googleapis.com/css2?family=${SITE_FONT_FAMILY.replace(/ /g, "+")}:wght@400;500;600;700;800&display=swap`;

export interface ComposeOptions {
  brief: ExpandedBrief;
  rawBrief: string;
  pages: Record<string, PlacedSection[]>;
  store?: TemplateStore;
  paletteId?: string;
  /** The template `select.ts` locked as this site's identity (its nav/footer/hero) — see
   *  `SelectedSite.anchorTemplateId`. When set, any OTHER template's CSS gets restyled toward the
   *  anchor's own container-width/corner-radius design fingerprint before it ships (`restyle-css.ts`)
   *  — a section mixed in from a compatible-but-not-identical template should line up with the rest
   *  of the page, not just avoid being flagged incompatible. Omitted entirely, every template's CSS
   *  ships exactly as `recolorCss` left it — pre-mixing behavior, and what a caller with no anchor
   *  concept (a direct `composeSite` test, an edit-session recompose that already pinned everything)
   *  still gets. */
  anchorTemplateId?: string;
  /** Resolves content-photo slots: the business's own uploaded photos first (via
   *  `registry.takeUserPhoto()`), a stock image (Pexels/Openverse/Picsum, per `activeImageProviders()`)
   *  once those run out. Omitted entirely, every photo slot falls back to a stock image directly —
   *  never left as the template author's own demo photography. */
  registry?: MediaRegistry;
  /** The business's own uploaded logo (`ctx.logoSrc`). An image-logo slot repoints its `<img>` at
   *  this when present; falls back to a text wordmark otherwise. */
  logoSrc?: string;
  /** Text edits made in the preview, keyed `<templateId>:<sectionId>#<ordinal>` — applied as the
   *  last step of each section so they win over both slot substitution and the filler pass. */
  overrides?: Record<string, string>;
  /** Photo URLs already resolved for this site, keyed `<templateId>:<sectionId>#<photoIndex>`.
   *  A recompose (any edit) must not re-roll imagery: stock lookups are seeded and would come back
   *  the same, but the business's own uploaded photos are taken from the media registry once and
   *  would silently be replaced by stock on the second pass. Pinning them makes an edit render the
   *  same site with one thing changed, which is the only thing an edit should ever do. */
  photos?: Record<string, string>;
  /** Emit the in-preview editing layer (click-to-edit text, per-section controls). Off for a
   *  published or exported site — this is a authoring affordance, not part of the deliverable. */
  editable?: boolean;
}

export interface FileCopy {
  /** Absolute source path inside the template cache. */
  from: string;
  /** Path relative to the site output root. */
  to: string;
}

/** One placed section's full record: which source template it came from, and exactly what
 *  changed in it — the data a stored generation shows for "which templates, what was changed". */
export interface SectionProvenance {
  templateId: string;
  templateName: string;
  sectionId: string;
  role: string;
  changes: CopyChange[];
  photosApplied: number;
  photosSkipped: number;
}

export interface ComposedSite {
  htmlPages: Record<string, string>;
  /** Every asset + stylesheet the composed pages reference, ready for the output writer. */
  files: FileCopy[];
  /** Per page, every section placed on it, in placed order — see `SectionProvenance`. */
  provenance: Record<string, SectionProvenance[]>;
  /** Every photo this render resolved, keyed for `ComposeOptions.photos` so the next recompose
   *  reproduces exactly these images. */
  photos: Record<string, string>;
  stats: {
    sectionsPlaced: number;
    slotsApplied: number;
    slotsSkipped: number;
    /** Of `slotsSkipped`, how many were a selector that no longer resolves against this section's
     *  cached HTML — ingest-time markup drift, not "the brief had nothing to say here". */
    selectorErrors: number;
    /** Placeholder text (lorem, the author's address/credit) rewritten with brief copy. */
    fillerRewritten: number;
    photosApplied: number;
    photosSkipped: number;
    templatesUsed: number;
    /** Saved preview edits written back into this render. */
    editsApplied: number;
  };
}

export function pageFileName(slug: string): string {
  return slug === "home" ? "index.html" : `${slug}.html`;
}

/**
 * Add the authoring layer to an already-composed page.
 *
 * Generation itself emits clean HTML — that is what gets published and exported, and it must never
 * carry an edit bar. The preview copy is the only place the layer belongs, so the playground adds
 * it as it writes the preview rather than composing the site twice (a second compose would also
 * re-consume the user's uploaded photos, which are taken from the registry once).
 */
export function withEditLayer(html: string): string {
  if (html.includes('id="wg-edit-style"')) return html;
  return html.includes("</body>") ? html.replace("</body>", `${EDIT_LAYER}\n</body>`) : `${html}${EDIT_LAYER}`;
}

/**
 * The in-preview authoring layer, injected only when `ComposeOptions.editable` is set.
 *
 * Deliberately dependency-free and inert until switched on: the preview must look exactly like the
 * delivered site until someone opts into editing. Text edits patch the DOM immediately and save in
 * the background (no reload — the viewer already sees the result); structural edits (reorder, swap,
 * remove) change which sections exist, so those recompose server-side and reload the frame.
 *
 * Addresses come from the markup itself: `data-wg-edit` on every run of copy (see
 * `anchorEditableText`), `data-tpl`/`data-section` on each section wrapper.
 */
const EDIT_LAYER = `<style id="wg-edit-style">
  .wg-edit-on [data-wg-edit]{outline:1px dashed rgba(99,102,241,.55);outline-offset:2px;cursor:text}
  .wg-edit-on [data-wg-edit]:hover{outline:2px solid #6366f1;background:rgba(99,102,241,.08)}
  .wg-edit-on [data-wg-edit][contenteditable="true"]{outline:2px solid #6366f1;background:rgba(99,102,241,.14)}
  .wg-edit-on [data-section]{position:relative}
  .wg-edit-on [data-section]:hover{outline:2px dashed rgba(16,185,129,.6);outline-offset:-2px}
  #wg-bar{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;gap:8px;align-items:center;
    font:500 13px/1 system-ui,sans-serif;background:#111;color:#fff;padding:8px 10px;border-radius:999px;
    box-shadow:0 6px 24px rgba(0,0,0,.35)}
  #wg-bar button{font:inherit;border:0;border-radius:999px;padding:6px 12px;cursor:pointer;background:#6366f1;color:#fff}
  #wg-bar button[aria-pressed="true"]{background:#10b981}
  #wg-bar span{opacity:.75;min-width:74px}
  .wg-tools{position:absolute;top:6px;right:6px;z-index:2147482000;display:none;gap:4px;
    font:500 12px/1 system-ui,sans-serif}
  .wg-edit-on [data-section]:hover > .wg-tools{display:flex}
  .wg-tools button,.wg-tools select{border:0;border-radius:6px;padding:5px 8px;cursor:pointer;
    background:#111;color:#fff;opacity:.92;font:inherit}
  .wg-tools button:hover{background:#6366f1}
</style>
<div id="wg-bar" hidden>
  <button type="button" id="wg-toggle" aria-pressed="false">Edit</button>
  <span id="wg-status">Preview</span>
</div>
<script>
(function () {
  var ADDABLE_ROLES = ["hero","features","story","gallery","pricing","faq","cta","contact","stats"];
  var page = (location.pathname.split("/").pop() || "index.html").replace(/\\.html$/, "");
  if (page === "index" || page === "") page = "home";
  var bar = document.getElementById("wg-bar");
  var toggle = document.getElementById("wg-toggle");
  var status = document.getElementById("wg-status");
  if (!bar || !toggle || !status) return;
  bar.hidden = false;
  var on = false;

  function say(text) {
    status.textContent = text;
  }

  async function send(revisions, opts) {
    say("Saving…");
    try {
      var res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: page, revisions: revisions }),
      });
      var data = await res.json();
      if (!res.ok || data.error) {
        say(data.error || "Failed");
        return false;
      }
      if (data.rejected && data.rejected.length) {
        say(data.rejected[0]);
        return false;
      }
      say("Saved");
      if (opts && opts.reload) location.reload();
      return true;
    } catch (err) {
      say("Offline");
      return false;
    }
  }

  // Text editing: patch in place, persist in the background.
  document.addEventListener("click", function (event) {
    if (!on) return;
    var el = event.target && event.target.closest ? event.target.closest("[data-wg-edit]") : null;
    if (!el) return;
    event.preventDefault();
    if (el.getAttribute("contenteditable") === "true") return;
    var before = el.textContent;
    el.setAttribute("contenteditable", "true");
    // A mousedown inside the section can leave focus on an ancestor (a card that is itself a
    // link), and an element only just made editable does not always take focus in the same tick —
    // retry on the next frame and drop the caret at the end so typing continues the text.
    function grabFocus(attempt) {
      el.focus();
      if (document.activeElement !== el && attempt < 3) {
        requestAnimationFrame(function () { grabFocus(attempt + 1); });
        return;
      }
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (err) {
        /* selection is best-effort — the field is editable either way */
      }
    }
    grabFocus(0);
    function finish() {
      el.removeAttribute("contenteditable");
      el.removeEventListener("blur", finish);
      el.removeEventListener("keydown", onKey);
      var value = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (value === (before || "").replace(/\\s+/g, " ").trim()) {
        say("Edit");
        return;
      }
      send([{ kind: "text", target: el.getAttribute("data-wg-edit"), value: value }]);
    }
    function onKey(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        el.textContent = before;
        el.blur();
      }
    }
    el.addEventListener("blur", finish);
    el.addEventListener("keydown", onKey);
  }, true);

  // Structural controls per section.
  function mountTools() {
    document.querySelectorAll("[data-section]").forEach(function (section) {
      if (section.querySelector(":scope > .wg-tools")) return;
      var tools = document.createElement("div");
      tools.className = "wg-tools";
      tools.innerHTML =
        '<button type="button" data-act="up" title="Move up">↑</button>' +
        '<button type="button" data-act="down" title="Move down">↓</button>' +
        '<button type="button" data-act="swap" title="Use a different template for this section">⟳</button>' +
        '<select data-act="add-role" title="Add a section below">' +
        ADDABLE_ROLES.map(function (role) { return '<option value="' + role + '">+ ' + role + '</option>'; }).join("") +
        '</select>' +
        '<button type="button" data-act="add" title="Add the selected section below">+</button>' +
        '<button type="button" data-act="remove" title="Remove section">✕</button>';
      tools.addEventListener("click", function (event) {
        var btn = event.target.closest("button");
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        var key = section.getAttribute("data-tpl") + ":" + section.getAttribute("data-section");
        var act = btn.getAttribute("data-act");
        if (act === "add") {
          var role = tools.querySelector('[data-act="add-role"]').value;
          send([{ kind: "addSection", page: page, role: role, after: key }], { reload: true });
        }
        else if (act === "remove") send([{ kind: "removeSection", target: key }], { reload: true });
        else if (act === "swap") send([{ kind: "swapSection", target: key }], { reload: true });
        else send([{ kind: "moveSection", target: key, direction: act }], { reload: true });
      });
      section.appendChild(tools);
    });
  }

  toggle.addEventListener("click", function () {
    on = !on;
    document.documentElement.classList.toggle("wg-edit-on", on);
    toggle.setAttribute("aria-pressed", String(on));
    toggle.textContent = on ? "Done" : "Edit";
    say(on ? "Click any text" : "Preview");
    if (on) mountTools();
  });
})();
</script>`;

function templateCssFileName(templateId: string): string {
  return `${templateId}.css`;
}

const PAGE_ORDER = ["home", "about", "services", "contact"];
const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  about: "About",
  services: "Services",
  contact: "Contact",
};

const NAV_TARGETS: Array<{ slug: string; re: RegExp }> = [
  { slug: "home", re: /^(home|start)$/i },
  { slug: "about", re: /\b(about|story|team|who we are)\b/i },
  // Plural forms matter: `\bservice\b` does not match the "Services" label every template uses.
  { slug: "services", re: /\b(services?|what we do|offers?|work|portfolio|pricing|plans?)\b/i },
  { slug: "contact", re: /\b(contacts?|get in touch|enquir\w*|book|appointments?)\b/i },
];

/**
 * Point a verbatim nav/footer at the pages this site actually has.
 *
 * Template navs advertise the template's own demo pages ("Home Two", "Header Styles", "404") via
 * dropdowns. Left alone, every one of those becomes a link to the home page — twenty links that
 * all go to the same place. Submenus are dropped and unmapped top-level items removed, which is
 * the one structural edit chrome needs to work as this site's navigation.
 */
function rewriteNavLinks(html: string, availableSlugs: string[], role: string): string {
  const $ = cheerio.load(html, null, false);

  $("ul ul, .sub-menu, .dropdown-menu, .submenu").remove();

  // The primary menu is rebuilt from this site's own pages, reusing the template's first list item
  // as the markup template so its classes (and therefore its styling) carry over untouched.
  if (role === "nav") {
    const menus = $("ul")
      .toArray()
      .map((node) => ({ node, links: $(node).children("li").find("a").length }))
      .sort((a, b) => b.links - a.links);
    const primary = menus[0];
    if (primary && primary.links >= 2) {
      const menu = $(primary.node);
      const sample = menu.children("li").first();
      if (sample.length > 0) {
        const items = PAGE_ORDER.filter((slug) => availableSlugs.includes(slug)).map((slug) => {
          const item = sample.clone();
          const anchor = item.find("a").first();
          anchor.attr("href", pageFileName(slug));
          anchor.text(PAGE_LABELS[slug] ?? slug);
          item.find("a").slice(1).remove();
          return $.html(item);
        });
        if (items.length > 0) menu.html(items.join(""));
      }
    }
  }

  $("a[href]").each((_, node) => {
    const el = $(node);
    const href = el.attr("href") ?? "";
    if (/^(https?:|mailto:|tel:)/i.test(href)) return;
    if (href === "#" || href.startsWith("#")) {
      // A labelled `#` link in chrome is a dropdown parent whose submenu was just removed; an
      // icon-only one is a real control (search, cart) and is left alone.
      const label = el.text().replace(/\s+/g, " ").trim();
      if (label && !NAV_TARGETS.some((row) => row.re.test(label))) {
        const item = el.closest("li");
        if (item.length > 0) item.remove();
      }
      return;
    }
    const label = el.text().replace(/\s+/g, " ").trim();
    const target = NAV_TARGETS.find(
      (row) => row.re.test(label) || row.re.test(href.replace(/[-_/]/g, " "))
    );
    if (!target || !availableSlugs.includes(target.slug)) {
      // A nav item this site has no page for: drop the item, keep the bare link only when it is
      // not part of a list (removing a stray anchor could take a button's styling with it).
      const item = el.closest("li");
      if (item.length > 0) {
        item.remove();
        return;
      }
      el.attr("href", pageFileName("home"));
      return;
    }
    el.attr("href", pageFileName(target.slug));
  });
  return $.html();
}

/** First-party page shell. Deliberately tiny: it owns only what no single template may own on a
 *  mixed page — the document background and default text color. */
function shellCss(paletteId: string): string {
  const palette = getPalette(paletteId);
  return `:root{color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:${palette.backgroundRamp[0]};color:${palette.textOnDark};-webkit-font-smoothing:antialiased}
/* Sections from different templates assume different container widths; one that overshoots must
   not give the whole page a horizontal scrollbar. */
html,body{overflow-x:hidden;max-width:100%}
[data-tpl]{max-width:100vw;overflow-x:clip}
img,video{max-width:100%;height:auto}
[data-tpl]{position:relative}
.tpl-wordmark{display:inline-block;font-weight:700;font-size:1.25rem;letter-spacing:-0.01em;color:inherit;white-space:nowrap}
/* One typeface across every section, regardless of source template — icons (<i> tags) are
   deliberately not listed here, so icon-font glyphs keep rendering as glyphs, not letters. */
[data-tpl] :where(h1,h2,h3,h4,h5,h6,p,a,span,li,label,button,input,select,textarea,strong,em,b,blockquote,td,th,caption,figcaption,small,div){font-family:${SITE_FONT_STACK}!important}`;
}

/** The slotted tagline often already opens with the business name; repeating it reads as a bug. */
function pageTitle(slug: string, businessName: string, tagline: string): string {
  if (slug !== "home") return `${slug[0]!.toUpperCase()}${slug.slice(1)} — ${businessName}`;
  const cleanTagline = tagline.trim();
  if (!cleanTagline || cleanTagline.toLowerCase().startsWith(businessName.toLowerCase())) {
    return cleanTagline || businessName;
  }
  return `${businessName} — ${cleanTagline}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function composeSite(options: ComposeOptions): Promise<ComposedSite> {
  const store = options.store ?? templateStore();
  const paletteId = options.paletteId ?? templatePaletteId();
  const contact = resolveContact(options.brief, options.rawBrief);
  const slugs = Object.keys(options.pages);

  const manifests = new Map<string, TemplateManifest>();
  const files = new Map<string, FileCopy>();
  const htmlPages: Record<string, string> = {};
  // Every asset a template's manifest ever registered was collected across ALL of that template's
  // original pages at ingest time — one used section (a hero) still shipped that template's entire
  // asset footprint (every other page's photos, unused icons) on a site that never composed those
  // pages. Confirmed: real generations pulled in tens of unused images per borrowed template,
  // directly fetchable at their `_tpl-assets/<templateId>/...` path despite nothing on the actual
  // site referencing them. Scoped below to what this site's composed HTML and CSS actually cite.
  const referencedAssetPaths = new Set<string>();
  const ASSET_REF_RE = /_tpl-assets\/[^\s"'()<>]+/g;

  /**
   * One template's stylesheet, reduced to what the markup placed from it on THIS page can match,
   * cached on disk under the template's own cache directory keyed by the markup signature — two
   * pages that place the same sections reuse one file, and so does a later regeneration.
   * Returns the copy entry plus the asset paths the reduced sheet still cites.
   */
  const cssBundles = new Map<string, { file: FileCopy; refs: Set<string> }>();
  /** Set only for a non-anchor template that is actually mixed onto this site AND has both its own
   *  and the anchor's design fingerprint on record — see `ComposeOptions.anchorTemplateId`. Absent
   *  for the anchor's own stylesheet (which defines the site's look and ships untouched) and for
   *  any template whose fingerprint isn't backfilled yet (nothing to restyle toward/from). */
  const restyleFor = (templateId: string, manifest: TemplateManifest): { source: DesignFingerprint; target: DesignFingerprint } | null => {
    if (!options.anchorTemplateId || templateId === options.anchorTemplateId) return null;
    if (!manifest.designFingerprint || !anchorFingerprint) return null;
    return { source: manifest.designFingerprint, target: anchorFingerprint };
  };
  const cssBundleFor = async (
    templateId: string,
    cssCachePath: string,
    tokens: MarkupTokens,
    restyle: { source: DesignFingerprint; target: DesignFingerprint } | null
  ): Promise<{ file: FileCopy; refs: Set<string> } | null> => {
    const fullPath = path.join(templateCachePath(templateId), cssCachePath);
    const signature = createHash("sha256")
      .update(
        [
          [...tokens.classes].sort().join(" "),
          [...tokens.ids].sort().join(" "),
          [...tokens.tags].sort().join(" "),
          [...tokens.attrs].sort().join(" "),
          restyle ? `restyle:${restyle.target.radiusScale}:${restyle.target.containerMaxWidthPx}` : "",
        ].join("\n")
      )
      .digest("hex")
      .slice(0, 12);
    const key = `${templateId}|${templateCssShakeEnabled() ? signature : "full"}`;
    const memo = cssBundles.get(key);
    if (memo) return memo;

    let css: string;
    try {
      css = await fs.readFile(fullPath, "utf8");
    } catch {
      return null;
    }
    if (restyle) css = restyleCss(css, restyle.source, restyle.target).css;

    let entry: { file: FileCopy; refs: Set<string> };
    if (!templateCssShakeEnabled()) {
      // A restyled sheet is generation-specific (it targets THIS site's anchor), so it can no longer
      // be shipped from the template's own cache path and shared across every site that ever borrows
      // this template — write it out under the same per-signature cache the shaken branch below uses.
      if (restyle) {
        const cacheFile = path.join(templateCachePath(templateId), "restyled", `${signature}.css`);
        try {
          await fs.mkdir(path.dirname(cacheFile), { recursive: true });
          await fs.writeFile(cacheFile, css, "utf8");
          entry = {
            file: { from: cacheFile, to: `${templateId}.${signature}.css` },
            refs: new Set([...css.matchAll(ASSET_REF_RE)].map((m) => m[0])),
          };
          cssBundles.set(key, entry);
          return entry;
        } catch {
          // Unwritable cache: fall through and ship the (already restyled, in-memory) full sheet
          // from the original path — wrong, but only cosmetically, and never for the common case.
        }
      }
      entry = {
        file: { from: fullPath, to: templateCssFileName(templateId) },
        refs: new Set([...css.matchAll(ASSET_REF_RE)].map((m) => m[0])),
      };
    } else {
      const shaken = shakeCss(css, tokens).css;
      const cacheFile = path.join(templateCachePath(templateId), "shaken", `${signature}.css`);
      try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, shaken, "utf8");
      } catch {
        // Unwritable cache (read-only mount): fall back to shipping the full sheet rather than
        // shipping nothing — a bloated page still renders, a missing stylesheet does not.
        entry = {
          file: { from: fullPath, to: templateCssFileName(templateId) },
          refs: new Set([...css.matchAll(ASSET_REF_RE)].map((m) => m[0])),
        };
        cssBundles.set(key, entry);
        return entry;
      }
      entry = {
        file: { from: cacheFile, to: `${templateId}.${signature}.css` },
        refs: new Set([...shaken.matchAll(ASSET_REF_RE)].map((m) => m[0])),
      };
    }
    cssBundles.set(key, entry);
    return entry;
  };
  let sectionsPlaced = 0;
  let slotsApplied = 0;
  let slotsSkipped = 0;
  let selectorErrors = 0;
  let fillerRewritten = 0;
  let photosApplied = 0;
  let photosSkipped = 0;
  let editsApplied = 0;
  const resolvedPhotos: Record<string, string> = {};
  // One classification for the whole site — every photo query is grounded in the same vertical
  // read the section-selection tier already used, not re-derived per section.
  const industry = classifyBriefTaxonomy(options.brief).industry.replace(/-/g, " ");

  const loadManifest = async (templateId: string): Promise<TemplateManifest | null> => {
    if (manifests.has(templateId)) return manifests.get(templateId)!;
    const manifest = await store.manifest(templateId);
    if (manifest) manifests.set(templateId, manifest);
    return manifest;
  };

  // Read once for the whole render: every non-anchor template's stylesheet gets restyled toward
  // this, never the other way around — see `ComposeOptions.anchorTemplateId`.
  const anchorFingerprint: DesignFingerprint | undefined = options.anchorTemplateId
    ? (await loadManifest(options.anchorTemplateId))?.designFingerprint
    : undefined;

  const provenance: Record<string, SectionProvenance[]> = {};

  for (const slug of slugs) {
    const placed = options.pages[slug] ?? [];
    const bodyParts: string[] = [];
    const usedTemplates = new Set<string>();
    const pageProvenance: SectionProvenance[] = [];
    // Per template, the union of everything its sections put on THIS page — the input to reducing
    // its stylesheet to the rules that can actually match here.
    const tokensByTemplate = new Map<string, MarkupTokens>();
    // Shared across every section on THIS page: a heading/narrative fallback that has already
    // written one sentence onto the page will not write it again in the next section — the fix
    // for a real generation where one sentence was pasted into four different slots on one page.
    const copyRunState = createCopyRunState();

    for (const section of placed) {
      const manifest = await loadManifest(section.templateId);
      if (!manifest) continue;
      const entry = manifest.sections.find((row) => row.id === section.sectionId);
      if (!entry) continue;

      let html: string;
      try {
        html = await fs.readFile(path.join(templateCachePath(section.templateId), entry.htmlCachePath), "utf8");
      } catch {
        continue;
      }

      const substituted = applyCopySlots(
        html,
        entry.slots,
        {
          brief: options.brief,
          rawBrief: options.rawBrief,
          role: section.role,
          logoSrc: options.logoSrc,
          runState: copyRunState,
        },
        contact
      );
      slotsApplied += substituted.applied;
      slotsSkipped += substituted.skipped;
      selectorErrors += substituted.selectorErrors;
      fillerRewritten += substituted.filler;

      // One LLM-curated search query per photo slot, grounded in this business and this section's
      // role — falls back to the old generic `${industry} ${role}` query (still index-aligned)
      // whenever no provider is configured or curation fails outside strict mode. See
      // `verbatim-media-agent.ts` for why this can't reuse `media-curator-agent.ts` directly.
      const photoQueries =
        entry.photoSlots.length > 0
          ? await curateVerbatimPhotoQueries(options.brief, section.role, entry.photoSlots, industry)
          : [];

      const withPhotos = await applyPhotoSlots(substituted.html, entry.photoSlots, async (slot, index) => {
        const photoKey = `${section.templateId}:${section.sectionId}#${index}`;
        const pinned = options.photos?.[photoKey];
        if (pinned) {
          resolvedPhotos[photoKey] = pinned;
          return pinned;
        }
        const query = (photoQueries[index] || `${industry} ${section.role}`).trim();
        const cacheKey = `${section.templateId}:${section.sectionId}:${index}`;
        // `resolveUniqueImage` already does everything the old inline block did by hand — the
        // business's own uploaded photo first, then a stock lookup deduped against every other
        // photo this render has already resolved (registry-wide, not just within this section) —
        // plus registration, in one call, matching what the react/skin-fill pipelines already get.
        const url = options.registry
          ? await resolveUniqueImage(
              query,
              cacheKey,
              options.registry,
              cacheKey,
              section.sectionId,
              slug,
              slot.width,
              slot.height,
              industry
            )
          : await stockImageUrl(query, cacheKey, industry, slot.width, slot.height);
        resolvedPhotos[photoKey] = url;
        return url;
      });
      photosApplied += withPhotos.applied;
      photosSkipped += withPhotos.skipped;

      const navRewritten =
        section.role === "nav" || section.role === "footer"
          ? rewriteNavLinks(withPhotos.html, slugs, section.role)
          : withPhotos.html;

      // Anchoring runs last, after every pass that could have changed the text, so an ordinal
      // addresses the run the viewer actually sees — and so a saved edit overrides all of them.
      const anchored = anchorEditableText(
        navRewritten,
        `${section.templateId}:${section.sectionId}`,
        options.overrides
      );
      const finalHtml = anchored.html;
      editsApplied += anchored.applied;

      for (const match of finalHtml.matchAll(ASSET_REF_RE)) referencedAssetPaths.add(match[0]);
      collectMarkupTokens(
        finalHtml,
        tokensByTemplate.get(section.templateId) ??
          tokensByTemplate.set(section.templateId, emptyTokens()).get(section.templateId)!
      );

      bodyParts.push(
        `<div data-tpl="${section.templateId}" data-role="${section.role}" data-section="${section.sectionId}">${finalHtml}</div>`
      );
      usedTemplates.add(section.templateId);
      sectionsPlaced += 1;

      // Recorded for every placed section, changes or not — "which template this page's nav came
      // from" is provenance on its own, even on a run that changed nothing in that section.
      pageProvenance.push({
        templateId: section.templateId,
        templateName: manifest.name,
        sectionId: section.sectionId,
        role: section.role,
        changes: [...substituted.changes, ...withPhotos.changes],
        photosApplied: withPhotos.applied,
        photosSkipped: withPhotos.skipped,
      });
    }

    provenance[slug] = pageProvenance;

    const pageCssHrefs: string[] = [];
    for (const templateId of usedTemplates) {
      const manifest = manifests.get(templateId);
      if (!manifest?.cssCachePath) continue;
      const bundle = await cssBundleFor(
        templateId,
        manifest.cssCachePath,
        tokensByTemplate.get(templateId) ?? emptyTokens(),
        restyleFor(templateId, manifest)
      );
      if (!bundle) continue;
      files.set(bundle.file.to, bundle.file);
      pageCssHrefs.push(bundle.file.to);
      // Assets the reduced stylesheet still cites might legitimately paint, so they ship. Anything
      // the manifest registered that appears in neither that sheet nor this site's markup came
      // from a page or section this site never composed, and is dropped rather than shipped unused.
      for (const asset of manifest.assets) {
        if (!bundle.refs.has(asset.outputRelPath) && !referencedAssetPaths.has(asset.outputRelPath)) continue;
        files.set(asset.outputRelPath, {
          from: path.join(templateCachePath(templateId), "src", manifest.sourceRootRelPath, asset.cachedRelPath),
          to: asset.outputRelPath,
        });
      }
    }

    const cssLinks = pageCssHrefs
      .map((href) => `<link rel="stylesheet" href="${href}">`)
      .join("\n    ");
    const title = pageTitle(slug, options.brief.businessName, options.brief.tagline);

    htmlPages[slug] = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(options.brief.elevatorPitch.slice(0, 160))}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="${SITE_FONT_LINK}">
    <style>${shellCss(paletteId)}</style>
    ${cssLinks}
  </head>
  <body>
${bodyParts.join("\n")}
${options.editable ? EDIT_LAYER : ""}
  </body>
</html>`;
  }

  return {
    htmlPages,
    files: [...files.values()],
    provenance,
    photos: resolvedPhotos,
    stats: {
      sectionsPlaced,
      slotsApplied,
      slotsSkipped,
      selectorErrors,
      fillerRewritten,
      photosApplied,
      photosSkipped,
      templatesUsed: manifests.size,
      editsApplied,
    },
  };
}
