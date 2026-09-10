/**
 * Namespace a section's element ids so sections from different templates can share one page.
 *
 * Templates reuse generic ids (`#hero`, `#about`, `#contact`, `#loading`). Two verbatim sections
 * from different templates on one page would otherwise collide on duplicate ids, and each one's
 * own in-page anchors (`href="#about"`) would resolve to whichever came first. Every id is
 * prefixed and every same-document reference is rewritten in lockstep, once at ingest.
 */
import * as cheerio from "cheerio";

const ID_REF_ATTRS = ["for", "aria-controls", "aria-labelledby", "aria-describedby", "data-target", "data-bs-target"];

export function namespaceIds(html: string, templateId: string): string {
  const $ = cheerio.load(html, null, false);
  const prefix = `${templateId}__`;
  const renamed = new Map<string, string>();

  $("[id]").each((_, node) => {
    const old = $(node).attr("id");
    if (!old || old.startsWith(prefix)) return;
    const next = `${prefix}${old}`;
    renamed.set(old, next);
    $(node).attr("id", next);
  });

  if (renamed.size === 0) return $.html();

  $("a[href^='#']").each((_, node) => {
    const href = $(node).attr("href") ?? "";
    const target = href.slice(1);
    const next = renamed.get(target);
    if (next) $(node).attr("href", `#${next}`);
  });

  for (const attr of ID_REF_ATTRS) {
    $(`[${attr}]`).each((_, node) => {
      const value = $(node).attr(attr) ?? "";
      // data-bs-target and friends carry selectors like "#navbarNav", plain ids elsewhere.
      const bare = value.startsWith("#") ? value.slice(1) : value;
      const next = renamed.get(bare);
      if (next) $(node).attr(attr, value.startsWith("#") ? `#${next}` : next);
    });
  }

  return $.html();
}

/** The id renames a stylesheet needs to follow (`#hero {}` -> `#tpl_x__hero {}`). */
export function collectIdRenames(html: string, templateId: string): Map<string, string> {
  const $ = cheerio.load(html, null, false);
  const prefix = `${templateId}__`;
  const renamed = new Map<string, string>();
  $("[id]").each((_, node) => {
    const old = $(node).attr("id");
    if (!old || old.startsWith(prefix)) return;
    renamed.set(old, `${prefix}${old}`);
  });
  return renamed;
}
