/**
 * One template zip -> cached, composable artifacts.
 *
 * Idempotent and content-addressed: the template id is a hash of the source zip bytes, so
 * re-running ingest over a bundle that already went through is a no-op rather than a re-extract.
 * Everything a generation run needs (section fragments, one scoped+recolored stylesheet, the
 * asset copy list) lands under `data/template-cache/<templateId>/` — the 50GB of raw zips is
 * never read again after first ingest.
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { templateCacheDir, templatePaletteId } from "../config.js";
import { getPalette } from "../palette.js";
import { classifyTemplateTaxonomy, type TaxonomyEvidenceSection } from "./classify-taxonomy.js";
import { TemplateManifestSchema, type TemplateManifest, type TemplateSection } from "../types.js";
import { classifySection } from "./classify-section.js";
import { extractPageSections } from "./extract-sections.js";
import { detectPhotoSlots } from "./photo-slots.js";
import { AssetCollector, rewriteCssUrls, rewriteHtmlAssets } from "./asset-manifest.js";
import { collectIdRenames, namespaceIds } from "./id-rewrite.js";
import { extractNestedZips, extractZipSafely, pickTemplateRoot } from "./normalize-archive.js";
import { recolorCss } from "./recolor-css.js";
import { extractDesignFingerprint } from "./design-fingerprint.js";
import { computeTemplateQuality } from "./quality-score.js";
import { sanitizeCss, scopeCss } from "./scope-css.js";

/** Pages parsed per template. Multi-page templates repeat their nav/footer/hero shapes, so the
 *  marginal value of page 13 is low and the cost at corpus scale is not. */
const MAX_PAGES_PER_TEMPLATE = 12;

export function templateCachePath(templateId: string): string {
  return path.join(templateCacheDir(), templateId);
}

export function manifestPath(templateId: string): string {
  return path.join(templateCachePath(templateId), "manifest.json");
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });
  return hash.digest("hex");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export async function readManifest(templateId: string): Promise<TemplateManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath(templateId), "utf8");
    const parsed = TemplateManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: TemplateManifest): Promise<TemplateManifest> {
  const parsed = TemplateManifestSchema.parse({ ...manifest, updatedAt: Date.now() });
  await fs.mkdir(templateCachePath(parsed.templateId), { recursive: true });
  await fs.writeFile(manifestPath(parsed.templateId), JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}

function templateNameFromZip(zipPath: string): string {
  return path
    .basename(zipPath)
    .replace(/\.zip$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** A bundle-folder name saying "this fits any business" rather than naming one. */
const UNIVERSAL_FIT_RE = /\b(multi-?purpose|all-?purpose|generic|universal|any\s*business|landing\s*pages?)\b/i;

export interface IngestOptions {
  /** Re-ingest even when a ready manifest already exists for these bytes. */
  force?: boolean;
  paletteId?: string;
  /** Name of the bundle subfolder this zip was found in (one level under the bundle root),
   *  e.g. "Restaurants". Classified into category/industry via the same taxonomy a brief goes
   *  through — see `TemplateManifestSchema.sourceCategoryHint`. */
  categoryHint?: string;
}

export async function ingestTemplateZip(zipPath: string, options: IngestOptions = {}): Promise<TemplateManifest> {
  const paletteId = options.paletteId ?? templatePaletteId();
  const digest = await hashFile(zipPath);
  const templateId = `tpl_${digest.slice(0, 12)}`;
  const cacheDir = templateCachePath(templateId);

  const existing = await readManifest(templateId);
  if (!options.force && existing && existing.status === "ready" && existing.paletteId === paletteId) {
    return existing;
  }

  const now = Date.now();
  const templateName = templateNameFromZip(zipPath);
  const folderSaysUniversal = Boolean(options.categoryHint && UNIVERSAL_FIT_RE.test(options.categoryHint));
  const base: TemplateManifest = {
    templateId,
    name: templateName,
    sourceZipPath: zipPath,
    sourceRootRelPath: "",
    status: "ingesting",
    paletteId,
    universalFit: folderSaysUniversal,
    industryRunnersUp: [],
    ...(options.categoryHint ? { sourceCategoryHint: options.categoryHint } : {}),
    assets: [],
    sections: [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeManifest(base);

  const srcDir = path.join(cacheDir, "src");
  await fs.rm(srcDir, { recursive: true, force: true });
  await extractZipSafely(zipPath, srcDir);
  await extractNestedZips(srcDir);

  const pick = await pickTemplateRoot(srcDir);
  if (!pick.rootDir) {
    return writeManifest({ ...base, status: "needs_review", reviewReason: pick.needsReview ?? "no template root" });
  }

  const rootDir = pick.rootDir;
  const pages = pick.htmlFiles
    .filter((file) => path.dirname(file) === rootDir)
    .sort((a, b) => {
      const aIndex = /(^|[\\/])(index|home)\.html?$/i.test(a) ? 0 : 1;
      const bIndex = /(^|[\\/])(index|home)\.html?$/i.test(b) ? 0 : 1;
      return aIndex - bIndex || a.localeCompare(b);
    })
    .slice(0, MAX_PAGES_PER_TEMPLATE);

  if (pages.length === 0) {
    return writeManifest({ ...base, status: "needs_review", reviewReason: "template root has no pages" });
  }

  const collector = new AssetCollector(templateId);
  const sections: TemplateSection[] = [];
  // Evidence for the template's own vertical, gathered as sections are classified — the hero
  // headline, the nav labels and the headings are already in hand here, so reading them costs
  // nothing beyond what section extraction does anyway. See `classify-taxonomy.ts`.
  const taxonomyEvidenceSections: TaxonomyEvidenceSection[] = [];
  const pageTitles: string[] = [];
  const seenSectionHashes = new Set<string>();
  const stylesheetRefs = new Set<string>();
  const inlineStyles: string[] = [];
  const idRenames = new Map<string, string>();

  await fs.rm(path.join(cacheDir, "sections"), { recursive: true, force: true });
  await fs.mkdir(path.join(cacheDir, "sections"), { recursive: true });

  for (const pageFile of pages) {
    const html = await fs.readFile(pageFile, "utf8");
    const pageDirRel = path.relative(rootDir, path.dirname(pageFile)).split(path.sep).join("/");
    const extraction = extractPageSections(html, path.basename(pageFile));
    if (extraction.title) pageTitles.push(extraction.title);
    for (const href of extraction.stylesheetHrefs) stylesheetRefs.add(`${pageDirRel}|${href}`);
    inlineStyles.push(...extraction.inlineStyles);

    for (const raw of extraction.sections) {
      // The same nav/footer repeats on every page of a multi-page template — store one copy.
      const fingerprint = hashText(raw.html.replace(/\s+/g, " "));
      if (seenSectionHashes.has(fingerprint)) continue;
      seenSectionHashes.add(fingerprint);

      for (const [from, to] of collectIdRenames(raw.html, templateId)) idRenames.set(from, to);
      const namespaced = namespaceIds(raw.html, templateId);
      const withAssets = rewriteHtmlAssets(namespaced, collector, pageDirRel);
      const classification = await classifySection(raw, withAssets);
      const sectionId = `sec_${String(sections.length).padStart(3, "0")}_${classification.role}`;
      const htmlCachePath = path.join("sections", `${sectionId}.html`);
      await fs.writeFile(path.join(cacheDir, htmlCachePath), withAssets, "utf8");

      const photoSlots = await detectPhotoSlots(withAssets, {
        rootDir,
        templateId,
        claimedSelectors: new Set(
          classification.slots.filter((slot) => slot.attr === "alt").map((slot) => slot.selector)
        ),
      });

      taxonomyEvidenceSections.push({
        role: classification.role,
        headingText: raw.headingText,
        text: raw.text,
        ...(classification.role === "nav" ? { html: withAssets } : {}),
      });

      sections.push({
        id: sectionId,
        templateId,
        role: classification.role,
        roleConfidence: classification.confidence,
        roleSource: classification.source,
        htmlCachePath,
        slots: classification.slots,
        photoSlots,
        sourceOrder: raw.sourceOrder,
      });
    }
  }

  if (sections.length === 0) {
    return writeManifest({ ...base, status: "needs_review", reviewReason: "no sections extracted" });
  }

  // One stylesheet per template: every sheet its pages referenced, plus inline <style> blocks,
  // asset-rewritten, then scoped and recolored. Each file is processed on its own so one
  // unparseable vendor file (real templates ship them) costs that file, not the whole template.
  const rawParts: string[] = [];
  const scopedParts: string[] = [];
  const skippedSheets: string[] = [];
  const palette = getPalette(paletteId);

  const addSheet = (css: string, dirRel: string, label: string): void => {
    const withAssets = rewriteCssUrls(sanitizeCss(css), collector, dirRel);
    rawParts.push(withAssets);
    try {
      scopedParts.push(scopeCss(withAssets, { templateId, idRenames }));
    } catch (err) {
      skippedSheets.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  for (const ref of stylesheetRefs) {
    const [pageDirRel = "", href = ""] = ref.split("|");
    const cssPath = path.resolve(rootDir, pageDirRel, href.split(/[?#]/)[0] ?? "");
    if (!cssPath.startsWith(rootDir)) continue;
    try {
      const css = await fs.readFile(cssPath, "utf8");
      const cssDirRel = path.relative(rootDir, path.dirname(cssPath)).split(path.sep).join("/");
      addSheet(css, cssDirRel, path.basename(cssPath));
    } catch {
      // A referenced stylesheet that is not in the package is skipped, not fatal.
    }
  }
  inlineStyles.forEach((style, index) => addSheet(style, "", `inline-${index}`));

  const sourceCssHash = hashText(rawParts.join("\n"));
  if (scopedParts.length === 0) {
    return writeManifest({ ...base, status: "needs_review", reviewReason: "no stylesheet could be parsed" });
  }

  let finalCss = "";
  let theme: "light" | "dark" | undefined;
  const scopedCss = scopedParts.join("\n\n");
  // Read before color remapping, but it wouldn't matter either way — recolor only rewrites color
  // values, never container widths, radii or spacing, so the fingerprint is the same computed
  // before or after it.
  const designFingerprint = extractDesignFingerprint(scopedCss);
  try {
    const recolored = recolorCss(scopedCss, palette);
    finalCss = recolored.css;
    theme = recolored.stats.sourceWasDark ? "dark" : "light";
  } catch (err) {
    return writeManifest({
      ...base,
      status: "needs_review",
      reviewReason: `recolor failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const cssCachePath = "styles.css";
  await fs.writeFile(path.join(cacheDir, cssCachePath), finalCss, "utf8");

  // Classification runs here, not up top, because the strongest evidence a template carries about
  // its own vertical — the hero headline — only exists once sections have been extracted and
  // role-classified. A zero-score result means nothing recognisable was said anywhere (folder
  // included); storing the classifier's arbitrary declared-order default in that case would
  // actively mislead selection, so the template stays untagged and lands in the last-resort tier.
  const taxonomy = classifyTemplateTaxonomy({
    ...(options.categoryHint ? { folderHint: options.categoryHint } : {}),
    templateName,
    pageTitles,
    sections: taxonomyEvidenceSections,
  });
  const tagged =
    taxonomy.source === "none"
      ? { taxonomySource: "none" as const }
      : {
          category: taxonomy.match.category,
          industry: taxonomy.match.industry,
          archetype: taxonomy.match.archetype,
          industryRunnersUp: taxonomy.match.runnersUp,
          industryConfidence: taxonomy.match.confidence,
          taxonomySource: taxonomy.source,
          // A "Multipurpose" folder was the seller's shelf label, not a property of the design.
          // Once the markup itself names a vertical, that is what the template is: 77 of the 78
          // universal-fit templates in this repo's own corpus turned out to have a dental clinic,
          // a bakery or an agency baked into their demo content, and treating them as eligible
          // everywhere is exactly how a bakery brief ended up drawing from a dental template. The
          // blanket-eligibility escape hatch stays only for the ones nothing could classify.
          universalFit: false,
        };

  const quality = computeTemplateQuality(sections, finalCss);

  return writeManifest({
    ...base,
    ...tagged,
    status: "ready",
    ...(skippedSheets.length > 0
      ? { reviewReason: `${skippedSheets.length} stylesheet(s) skipped: ${skippedSheets.join("; ").slice(0, 300)}` }
      : {}),
    sourceRootRelPath: path.relative(srcDir, rootDir).split(path.sep).join("/"),
    cssCachePath,
    sourceCssHash,
    theme,
    designFingerprint,
    qualityScore: quality.score,
    qualityFlags: quality.flags,
    assets: collector.manifest(),
    sections,
  });
}
