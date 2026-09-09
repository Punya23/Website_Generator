/**
 * Resolves the hand-authored descriptors in `real-estate-map.ts` against one template's real HTML
 * files, producing a `PlacementsFile`.
 *
 * Every selector is asserted to resolve to EXACTLY one element on its page — 0 or 2+ is a build
 * error, not a warning. That assertion is what makes the hand-authored map in `real-estate-map.ts`
 * trustworthy despite not being derived from the markup automatically: a selector typo or a
 * template that has quietly drifted from the shared shape fails loudly here, at generation time,
 * rather than silently mis-targeting (or targeting nothing) at fill time.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { labelConstraints, proseConstraints, TYPE_SCALE } from "./measure.js";
import {
  chromeDescriptors,
  REAL_ESTATE_PAGE_ORDER,
  realEstatePageBuilders,
  sectionForId,
  type ImageDescriptor,
  type PageDescriptorSet,
  type TextDescriptor,
  type TextMode,
} from "./real-estate-map.js";
import {
  ImagePlacementSchema,
  PagePlacementsSchema,
  PlacementsFileSchema,
  SCHEMA_VERSION,
  TextPlacementSchema,
  type ImagePlacement,
  type PagePlacements,
  type PlacementsFile,
  type TextConstraints,
  type TextPlacement,
} from "./schema.js";

function computeConstraints(mode: TextMode, original: string): TextConstraints {
  if (mode.mode === "label") return labelConstraints(mode.maxWords, original);
  const typo = TYPE_SCALE[mode.typo];
  if (!typo) throw new Error(`Unknown typography key "${mode.typo}" — add it to measure.ts's TYPE_SCALE.`);
  return proseConstraints(typo, mode.widthPx, mode.lines, original);
}

function assertOne($: cheerio.CheerioAPI, page: string, d: { id: string; selector: string }): cheerio.Cheerio<any> {
  const matches = $(d.selector);
  if (matches.length !== 1) {
    throw new Error(
      `[${page}] placement "${d.id}": selector ${JSON.stringify(d.selector)} matched ${matches.length} element(s), expected exactly 1`
    );
  }
  return matches;
}

/** The element's visible text, collapsed and trimmed — with `stripChildSelectors` removed from a
 *  CLONE first, so a decorative icon glyph (an accordion's "+", a numbered badge) never leaks into
 *  the reference copy or the character budget it seeds. */
function readOriginalText($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>, strip?: string[]): string {
  const node = strip && strip.length > 0 ? el.clone() : el;
  if (strip) for (const sel of strip) node.find(sel).remove();
  return node.text().replace(/\s+/g, " ").trim();
}

function resolveText($: cheerio.CheerioAPI, page: string, d: TextDescriptor): TextPlacement {
  const el = assertOne($, page, d).first();
  const original = readOriginalText($, el, d.stripChildSelectors);
  const tag = (el.get(0) as { tagName?: string } | undefined)?.tagName ?? "*";
  return TextPlacementSchema.parse({
    id: d.id,
    kind: "text",
    page,
    selector: d.selector,
    tag,
    section: sectionForId(d.id),
    role: d.role,
    fillSource: d.fillSource,
    original,
    constraints: computeConstraints(d.text, original),
    ...(d.briefField ? { briefField: d.briefField } : {}),
    ...(d.preserveChildren ? { preserveChildren: true } : {}),
    ...(d.compose ? { compose: d.compose } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
  });
}

/** `background-image:url('...')` out of an element's inline `style` attribute. */
const BG_URL_RE = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;

function resolveImage($: cheerio.CheerioAPI, page: string, d: ImageDescriptor): ImagePlacement {
  const el = assertOne($, page, d).first();
  const original =
    d.domKind === "background" ? (BG_URL_RE.exec(el.attr("style") ?? "")?.[1] ?? "") : (el.attr("src") ?? "");
  return ImagePlacementSchema.parse({
    id: d.id,
    kind: "image",
    page,
    selector: d.selector,
    domKind: d.domKind,
    section: sectionForId(d.id),
    role: d.role,
    fillSource: d.fillSource,
    original,
    constraints: { aspectRatio: d.aspectRatio, minWidthPx: d.minWidthPx, minHeightPx: d.minHeightPx },
    subject: d.subject,
    ...(d.notes ? { notes: d.notes } : {}),
  });
}

function resolvePage($: cheerio.CheerioAPI, set: PageDescriptorSet, title?: string): PagePlacements {
  return PagePlacementsSchema.parse({
    page: set.page,
    ...(title !== undefined ? { title } : {}),
    text: set.text.map((d) => resolveText($, set.page, d)),
    images: set.images.map((d) => resolveImage($, set.page, d)),
  });
}

/**
 * Builds one template's full `PlacementsFile` from its extracted-HTML folder (e.g.
 * `real-estate/real-estate-agency/`). `templateId` is the folder name — stable across
 * regenerations, and how `real-estate/PLACEMENTS_SCHEMA.md` refers to a specific template.
 *
 * Chrome (nav/topbar/footer) is read from `index.html` only: it is verified byte-identical across
 * every page of a given template (see `real-estate-map.ts`'s header comment), so re-reading it
 * from all eight would only re-verify what generating this same file already re-verifies every
 * time it's regenerated.
 */
export async function extractRealEstateTemplate(templateDir: string, templateId: string): Promise<PlacementsFile> {
  const indexHtml = await fs.readFile(path.join(templateDir, "index.html"), "utf8");
  const index$ = cheerio.load(indexHtml);

  const pages: Record<string, PagePlacements> = {
    chrome: resolvePage(index$, chromeDescriptors()),
  };
  let templateName = templateId;

  for (const set of realEstatePageBuilders()) {
    const html = await fs.readFile(path.join(templateDir, set.page), "utf8");
    const $ = cheerio.load(html);
    const title = $("title").first().text().replace(/\s+/g, " ").trim();
    if (set.page === "index.html" && title) templateName = title.split("|")[0]?.trim() || title;
    pages[set.page] = resolvePage($, set, title || undefined);
  }

  return PlacementsFileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    vertical: "real-estate",
    templateId,
    templateName,
    generatedAt: new Date().toISOString(),
    pageOrder: REAL_ESTATE_PAGE_ORDER,
    pages,
  });
}
