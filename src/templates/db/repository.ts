/**
 * The seam a database drops into.
 *
 * Every read the generator and the admin surface actually perform against the corpus goes through
 * this interface. Today the only implementation reads the local files that already exist
 * (`FileTemplateRepository`); when a Postgres connection arrives, a second implementation of the
 * same interface against `schema.sql` replaces it without touching selection, composition, the
 * pipeline or the admin routes.
 *
 * Kept deliberately narrow: these are the queries the app makes, not a general ORM surface. Adding
 * a method here should mean the app grew a new question, not that a table grew a column.
 */
import { listGenerations, getGeneration, type GenerationRecord } from "../generation-store.js";
import { loadSiteState, saveSiteState } from "../site-state-store.js";
import { templateStore, type IndexedSection, type TemplateIndex } from "../store.js";
import { readManifest } from "../ingest/ingest-template.js";
import { templatesBundleDir } from "../config.js";
import { findFiles } from "../ingest/normalize-archive.js";
import { SectionHistoryStore, sectionKey } from "../select.js";
import type { TemplateManifest, SectionRole } from "../types.js";
import type { VerbatimSiteState } from "../revise.js";

export interface SectionQuery {
  role?: SectionRole;
  industry?: string;
  category?: string;
  theme?: "light" | "dark";
  /** Templates classified as fitting any vertical stay eligible regardless of `industry`. */
  includeUniversalFit?: boolean;
}

export interface CorpusSummary {
  templates: number;
  ready: number;
  needsReview: number;
  failed: number;
  sections: number;
  byRole: Record<string, number>;
  /** Section counts, not template counts — a 60-section template and a 6-section one both tagged
   *  the same industry contribute unequally here. Kept for backward compatibility; use
   *  `byIndustryTemplates` to answer "how many DISTINCT templates does vertical X have", which
   *  this cannot (a single rich template can make a 1-template vertical look populated). */
  byIndustry: Record<string, number>;
  /** Distinct template counts per industry — every industry the corpus has anything for, not just
   *  the busiest ones, so a thin vertical (the exact thing that made "2n Fitness" keep landing on
   *  the same 1-2 anchors) is visible instead of silently absent from a top-N view. */
  byIndustryTemplates: Record<string, number>;
  byCategory: Record<string, number>;
  byTheme: Record<string, number>;
  /** Ready templates carrying no industry classification at all — the ingest backlog. */
  untagged: number;
  /** How many `.zip` files actually sit in `templatesBundleDir()` right now vs. how many of those
   *  have ever been ingested (any status) — the gap the admin corpus view previously had no way to
   *  show: ingest running with `--limit`, or new zips dropped in since the last run, looked
   *  identical to a fully-ingested corpus. */
  bundle: { zipsOnDisk: number; ingested: number };
  /** Ready templates excluded by the quality gate (`select.ts`, 2+ `qualityFlags`) — never
   *  selectable regardless of taxonomy fit. See `ingest/quality-score.ts`. */
  qualityBelowGate: number;
}

export interface TemplateRepository {
  /** Whole-corpus counts for the admin overview. */
  summary(): Promise<CorpusSummary>;
  /** The selection pool. */
  sections(query?: SectionQuery): Promise<IndexedSection[]>;
  /** Everything about one template, including its section list and asset manifest. */
  template(templateId: string): Promise<TemplateManifest | null>;
  /** Templates in status order for the review queue. */
  templates(filter?: { status?: TemplateManifest["status"]; search?: string; limit?: number }): Promise<
    TemplateIndex["templates"]
  >;
  generations(options?: { limit?: number; consumerId?: string }): Promise<GenerationRecord[]>;
  generation(id: string): Promise<GenerationRecord | null>;
  siteState(key?: string): Promise<VerbatimSiteState | null>;
  saveState(state: VerbatimSiteState, key?: string): Promise<void>;
  /** The anti-repeat memory `select.ts`'s anchor/section picking reads and writes for one
   *  consumer — previously had no admin-visible surface at all despite driving "don't repeat the
   *  same template" behavior. Enriched with template name + role since the raw store only keys by
   *  `templateId:sectionId`. */
  consumerHistory(consumerId: string): Promise<Array<{ templateId: string; templateName?: string; sectionId: string; role?: string }>>;
}

/** Backed by the local template cache + JSON/NDJSON stores that exist today. */
export class FileTemplateRepository implements TemplateRepository {
  constructor(private readonly store = templateStore()) {}

  async summary(): Promise<CorpusSummary> {
    const index = await this.store.index();
    const byRole: Record<string, number> = {};
    const byIndustry: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byTheme: Record<string, number> = {};
    const taggedTemplates = new Set<string>();
    const industryTemplates = new Map<string, Set<string>>();

    for (const section of index.sections) {
      byRole[section.role] = (byRole[section.role] ?? 0) + 1;
      if (section.industry) {
        byIndustry[section.industry] = (byIndustry[section.industry] ?? 0) + 1;
        taggedTemplates.add(section.templateId);
        const set = industryTemplates.get(section.industry) ?? new Set<string>();
        set.add(section.templateId);
        industryTemplates.set(section.industry, set);
      }
      if (section.category) byCategory[section.category] = (byCategory[section.category] ?? 0) + 1;
      if (section.theme) byTheme[section.theme] = (byTheme[section.theme] ?? 0) + 1;
    }
    const byIndustryTemplates: Record<string, number> = {};
    for (const [industry, set] of industryTemplates) byIndustryTemplates[industry] = set.size;

    const ready = index.templates.filter((row) => row.status === "ready");
    let zipsOnDisk = 0;
    try {
      zipsOnDisk = (await findFiles(templatesBundleDir(), (name) => name.toLowerCase().endsWith(".zip"))).length;
    } catch {
      // Bundle directory missing/unreadable — report 0 rather than failing the whole summary.
    }

    return {
      templates: index.templates.length,
      ready: ready.length,
      needsReview: index.templates.filter((row) => row.status === "needs_review").length,
      failed: index.templates.filter((row) => row.status === "failed").length,
      sections: index.sections.length,
      byRole,
      byIndustry,
      byIndustryTemplates,
      byCategory,
      byTheme,
      untagged: ready.filter((row) => !taggedTemplates.has(row.templateId)).length,
      bundle: { zipsOnDisk, ingested: index.templates.length },
      qualityBelowGate: ready.filter(
        (row) => row.qualityFlags && Object.values(row.qualityFlags).filter(Boolean).length >= 2
      ).length,
    };
  }

  async sections(query: SectionQuery = {}): Promise<IndexedSection[]> {
    const index = await this.store.index();
    return index.sections.filter((section) => {
      if (query.role && section.role !== query.role) return false;
      if (query.theme && section.theme && section.theme !== query.theme) return false;
      const universal = query.includeUniversalFit !== false && section.universalFit;
      if (query.industry && !universal && section.industry !== query.industry) return false;
      if (query.category && !universal && section.category !== query.category) return false;
      return true;
    });
  }

  async template(templateId: string): Promise<TemplateManifest | null> {
    return readManifest(templateId);
  }

  async templates(
    filter: { status?: TemplateManifest["status"]; search?: string; limit?: number } = {}
  ): Promise<TemplateIndex["templates"]> {
    const index = await this.store.index();
    const needle = filter.search?.trim().toLowerCase();
    const rows = index.templates.filter((row) => {
      if (filter.status && row.status !== filter.status) return false;
      if (needle && !`${row.name} ${row.templateId}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async generations(options: { limit?: number; consumerId?: string } = {}): Promise<GenerationRecord[]> {
    return listGenerations(options);
  }

  async generation(id: string): Promise<GenerationRecord | null> {
    return getGeneration(id);
  }

  async siteState(key?: string): Promise<VerbatimSiteState | null> {
    return loadSiteState(key);
  }

  async saveState(state: VerbatimSiteState, key?: string): Promise<void> {
    return saveSiteState(state, key);
  }

  async consumerHistory(
    consumerId: string
  ): Promise<Array<{ templateId: string; templateName?: string; sectionId: string; role?: string }>> {
    const used = await new SectionHistoryStore().getUsed(consumerId);
    const index = await this.store.index();
    const bySectionKey = new Map(index.sections.map((section) => [sectionKey(section), section]));
    return used.map((key) => {
      const [templateId = "", sectionId = ""] = key.split(":");
      const section = bySectionKey.get(key);
      return {
        templateId,
        sectionId,
        ...(section ? { templateName: section.templateName, role: section.role } : {}),
      };
    });
  }
}

let cached: TemplateRepository | null = null;

/** The repository the app uses. Swap the construction here when a database is configured. */
export function templateRepository(): TemplateRepository {
  cached ??= new FileTemplateRepository();
  return cached;
}
