import fs from "node:fs/promises";
import path from "node:path";
import type { ExpandedBrief, PagePlan, SitePlan } from "../types.js";
import { pickFrom } from "../design/variation.js";
import { getSkin, skinsForCategory, allSkins } from "./catalog.js";
import {
  SKIN_PAGE_TITLES,
  type SiteSkin,
  type SkinCategory,
  type SkinVisualFamily,
} from "./schema.js";
import { classifyTaxonomy, taxonomyAffinity, type TaxonomyMatch } from "./taxonomy.js";
import { skinLayoutSignature } from "../admin/approved-skins.js";

const ADJACENT: Record<SkinCategory, SkinCategory[]> = {
  "local-service": ["hospitality", "professional"],
  hospitality: ["local-service", "creative"],
  professional: ["creative", "local-service"],
  creative: ["professional", "hospitality"],
};


export interface SkinHistoryFile {
  consumers: Record<string, { used: string[]; updatedAt: number }>;
}

export class SkinHistoryStore {
  constructor(private readonly filePath: string) {}

  async getUsed(consumerId: string): Promise<string[]> {
    const data = await this.read();
    return data.consumers[consumerId]?.used ?? [];
  }

  async record(consumerId: string, skinId: string): Promise<void> {
    const data = await this.read();
    const prev = data.consumers[consumerId]?.used ?? [];
    const used = prev.includes(skinId) ? prev : [...prev, skinId];
    data.consumers[consumerId] = { used, updatedAt: Date.now() };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  private async read(): Promise<SkinHistoryFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SkinHistoryFile;
      if (!parsed || typeof parsed !== "object" || !parsed.consumers) {
        return { consumers: {} };
      }
      return parsed;
    } catch {
      return { consumers: {} };
    }
  }
}

export function defaultSkinHistoryPath(): string {
  return path.resolve(process.cwd(), "data", "consumer-skins.json");
}

export function briefTaxonomyText(brief: ExpandedBrief): string {
  return [
    brief.businessName,
    brief.tagline,
    brief.elevatorPitch,
    brief.expandedBrief,
    brief.tone,
    ...brief.services,
    ...brief.differentiators,
  ].join(" ");
}

/** Full industry × archetype classification for a brief. Deterministic, no LLM call. */
export function classifyBriefTaxonomy(brief: ExpandedBrief): TaxonomyMatch {
  return classifyTaxonomy(briefTaxonomyText(brief));
}

export function classifySkinCategory(brief: ExpandedBrief): SkinCategory {
  return classifyBriefTaxonomy(brief).category;
}

export interface PickSkinOptions {
  brief: ExpandedBrief;
  usedSkinIds?: string[];
  variationSeed?: number | string;
  profileId?: SkinVisualFamily;
}

export function pickSkinFromCatalog(options: PickSkinOptions): SiteSkin {
  const match = classifyBriefTaxonomy(options.brief);
  const category = match.category;
  const used = new Set(options.usedSkinIds ?? []);
  const seed = options.variationSeed ?? options.brief.businessName;

  // Narrow to the best taxonomy tier first (industry hit beats runner-up beats category-only),
  // then apply the vertical profile's visual-family preference inside that tier.
  const ranked = (pool: SiteSkin[]): SiteSkin[] => {
    if (pool.length === 0) return pool;
    const scored = pool.map((skin) => ({ skin, affinity: taxonomyAffinity(skin, match) }));
    const best = Math.max(...scored.map((row) => row.affinity));
    let tier = best > 0 ? scored.filter((row) => row.affinity === best).map((row) => row.skin) : pool;
    if (options.profileId) {
      const preferred = tier.filter((skin) => skin.visualFamily === options.profileId);
      if (preferred.length > 0) tier = preferred;
    }
    return tier;
  };

  const unused = (pool: SiteSkin[]) => pool.filter((skin) => !used.has(skin.id));
  const usedSignatures = new Set(
    allSkins()
      .filter((skin) => used.has(skin.id))
      .map((skin) => skinLayoutSignature(skin))
  );
  const unusedUnseen = (pool: SiteSkin[]) =>
    unused(pool).filter((skin) => !usedSignatures.has(skinLayoutSignature(skin)));

  const pickPool = (pool: SiteSkin[], key: string): SiteSkin | null => {
    const fresh = unusedUnseen(pool);
    if (fresh.length > 0) return pickFrom(seed, key, ranked(fresh));
    const leftover = unused(pool);
    if (leftover.length > 0) return pickFrom(seed, key, ranked(leftover));
    return null;
  };

  const categoryPool = skinsForCategory(category);
  const fromCategory = pickPool(categoryPool, `skin:${category}`);
  if (fromCategory) return fromCategory;

  for (const next of ADJACENT[category]) {
    const fromAdjacent = pickPool(skinsForCategory(next), `skin:${next}`);
    if (fromAdjacent) return fromAdjacent;
  }

  const fromAny = pickPool(allSkins(), "skin:any");
  if (fromAny) return fromAny;

  return pickFrom(seed, `skin:repeat:${category}`, ranked(categoryPool));
}

export async function pickSiteSkin(options: {
  brief: ExpandedBrief;
  consumerId?: string;
  variationSeed?: number | string;
  profileId?: SkinVisualFamily;
  history?: SkinHistoryStore;
}): Promise<SiteSkin> {
  const store = options.history ?? new SkinHistoryStore(defaultSkinHistoryPath());
  const usedSkinIds = options.consumerId ? await store.getUsed(options.consumerId) : [];
  const skin = pickSkinFromCatalog({
    brief: options.brief,
    usedSkinIds,
    variationSeed: options.variationSeed,
    profileId: options.profileId,
  });
  if (options.consumerId) {
    await store.record(options.consumerId, skin.id);
  }
  return skin;
}

export function alignSitePlanToSkin(sitePlan: SitePlan, skin: SiteSkin): SitePlan {
  const pages: PagePlan[] = Object.keys(skin.pages).map((slug) => {
    const existing = sitePlan.pages.find((page) => page.slug === slug);
    const titles = SKIN_PAGE_TITLES[slug] ?? {
      title: slug,
      navLabel: slug,
      goal: existing?.goal ?? "Tell the story",
    };
    return {
      slug,
      title: existing?.title ?? titles.title,
      navLabel: existing?.navLabel ?? titles.navLabel,
      goal: existing?.goal ?? titles.goal,
      minBlocks: existing?.minBlocks ?? 4,
      layoutHint: existing?.layoutHint ?? titles.goal,
      contentFocus: existing?.contentFocus ?? [titles.goal],
    };
  });

  return {
    ...sitePlan,
    pages,
    compositionStrategy: `Skin ${skin.id}: ${skin.description}`,
  };
}

export { getSkin, SITE_SKINS, allSkins } from "./catalog.js";
