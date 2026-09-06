/**
 * Index over the ingested template cache.
 *
 * Selection must not load the corpus: at 1000+ templates the per-section HTML and per-template
 * stylesheets are hundreds of MB, while the facts a picker needs (role, template, slot kinds) are
 * a few dozen bytes each. So ingest writes a flat index and generation reads only that, pulling
 * full section HTML for the handful of sections a page actually places.
 *
 * Persistence mirrors `src/admin/store.ts`: atomic temp-file+rename writes, and a corrupt index is
 * rebuilt from the manifests on disk rather than silently treated as "no templates".
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { templateCacheDir, templateStorePath } from "./config.js";
import { manifestPath, readManifest } from "./ingest/ingest-template.js";
import { SKIN_CATEGORIES, INDUSTRIES, SITE_ARCHETYPES } from "../skins/taxonomy.js";
import {
  DesignFingerprintSchema,
  SECTION_ROLES,
  SLOT_KINDS,
  type SectionRole,
  type TemplateManifest,
} from "./types.js";

export const IndexedSectionSchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  sectionId: z.string(),
  role: z.enum(SECTION_ROLES),
  roleConfidence: z.number(),
  slotKinds: z.array(z.enum(SLOT_KINDS)).default([]),
  sourceOrder: z.number(),
  /** Carried from the template's manifest so selection can rank by taxonomy fit without loading
   *  the full manifest per candidate — see `src/templates/select.ts`. */
  category: z.enum(SKIN_CATEGORIES).optional(),
  industry: z.enum(INDUSTRIES).optional(),
  archetype: z.enum(SITE_ARCHETYPES).optional(),
  /** Near-miss industries from the template's own classification. Selection accepts these one
   *  tier below an exact industry match, which is what lets a hard industry lock stay hard
   *  without emptying the pool for a vertical the corpus is thin on. */
  industryRunnersUp: z.array(z.enum(INDUSTRIES)).default([]),
  universalFit: z.boolean().default(false),
  /** The source template's original light/dark theme — see `TemplateManifestSchema.theme`.
   *  Unset for anything ingested before the field existed, until backfilled or re-ingested. */
  theme: z.enum(["light", "dark"]).optional(),
  /** See `TemplateManifestSchema.designFingerprint`. Carried per-section (duplicated across every
   *  section of the same template, same pattern as `theme`/`category`) so `select.ts` can score
   *  cross-template compatibility without loading the full manifest per candidate. */
  designFingerprint: DesignFingerprintSchema.optional(),
});
export type IndexedSection = z.infer<typeof IndexedSectionSchema>;

export const TemplateIndexSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number(),
  templates: z
    .array(
      z.object({
        templateId: z.string(),
        name: z.string(),
        status: z.enum(["ingesting", "ready", "needs_review", "failed"]),
        reviewReason: z.string().optional(),
        sectionCount: z.number(),
        assetCount: z.number(),
        paletteId: z.string().optional(),
        /** The template's classification, so a corpus-wide audit ("how many restaurant
         *  templates do we actually have?") reads one file instead of 900 manifests. */
        category: z.enum(SKIN_CATEGORIES).optional(),
        industry: z.enum(INDUSTRIES).optional(),
        taxonomySource: z.enum(["folder", "content", "combined", "none"]).optional(),
        theme: z.enum(["light", "dark"]).optional(),
        designFingerprint: DesignFingerprintSchema.optional(),
      })
    )
    .default([]),
  sections: z.array(IndexedSectionSchema).default([]),
});
export type TemplateIndex = z.infer<typeof TemplateIndexSchema>;

const EMPTY_INDEX: TemplateIndex = { version: 1, updatedAt: 0, templates: [], sections: [] };

export class TemplateStore {
  private cached: TemplateIndex | null = null;

  constructor(private readonly indexPath = templateStorePath()) {}

  async index(): Promise<TemplateIndex> {
    if (this.cached) return this.cached;
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      const parsed = TemplateIndexSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        this.cached = parsed.data;
        return parsed.data;
      }
    } catch {
      // Missing or unreadable index — rebuilding from manifests is cheap and always correct.
    }
    return this.rebuild();
  }

  /** Rebuild the index by reading every manifest in the cache directory. */
  async rebuild(): Promise<TemplateIndex> {
    const dir = templateCacheDir();
    let entries: string[] = [];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("tpl_"))
        .map((entry) => entry.name);
    } catch {
      this.cached = { ...EMPTY_INDEX };
      return this.cached;
    }

    const index: TemplateIndex = { version: 1, updatedAt: Date.now(), templates: [], sections: [] };
    for (const templateId of entries) {
      const manifest = await readManifest(templateId);
      if (!manifest) continue;
      index.templates.push({
        templateId: manifest.templateId,
        name: manifest.name,
        status: manifest.status,
        ...(manifest.reviewReason ? { reviewReason: manifest.reviewReason } : {}),
        sectionCount: manifest.sections.length,
        assetCount: manifest.assets.length,
        ...(manifest.paletteId ? { paletteId: manifest.paletteId } : {}),
        ...(manifest.category ? { category: manifest.category } : {}),
        ...(manifest.industry ? { industry: manifest.industry } : {}),
        ...(manifest.taxonomySource ? { taxonomySource: manifest.taxonomySource } : {}),
        ...(manifest.theme ? { theme: manifest.theme } : {}),
        ...(manifest.designFingerprint ? { designFingerprint: manifest.designFingerprint } : {}),
      });
      if (manifest.status !== "ready") continue;
      for (const section of manifest.sections) {
        index.sections.push({
          templateId: manifest.templateId,
          templateName: manifest.name,
          sectionId: section.id,
          role: section.role,
          roleConfidence: section.roleConfidence,
          slotKinds: [...new Set(section.slots.map((slot) => slot.kind))],
          sourceOrder: section.sourceOrder,
          ...(manifest.category ? { category: manifest.category } : {}),
          ...(manifest.industry ? { industry: manifest.industry } : {}),
          ...(manifest.archetype ? { archetype: manifest.archetype } : {}),
          industryRunnersUp: manifest.industryRunnersUp,
          universalFit: manifest.universalFit,
          ...(manifest.theme ? { theme: manifest.theme } : {}),
          ...(manifest.designFingerprint ? { designFingerprint: manifest.designFingerprint } : {}),
        });
      }
    }

    await this.write(index);
    this.cached = index;
    return index;
  }

  async sectionsForRole(role: SectionRole): Promise<IndexedSection[]> {
    return (await this.index()).sections.filter((section) => section.role === role);
  }

  async manifest(templateId: string): Promise<TemplateManifest | null> {
    return readManifest(templateId);
  }

  async manifestExists(templateId: string): Promise<boolean> {
    try {
      await fs.access(manifestPath(templateId));
      return true;
    } catch {
      return false;
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  private async write(index: TemplateIndex): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    const tmp = path.join(
      path.dirname(this.indexPath),
      `.${path.basename(this.indexPath)}.tmp-${process.pid}-${index.updatedAt}`
    );
    await fs.writeFile(tmp, JSON.stringify(index), "utf8");
    await fs.rename(tmp, this.indexPath);
  }
}

let shared: TemplateStore | null = null;

export function templateStore(): TemplateStore {
  shared ??= new TemplateStore();
  return shared;
}
