/**
 * Renders a throwaway "what would this actually look like" build of an ingest candidate's
 * draft skin, using the exact same React section library and build pipeline a real generation
 * uses — just with a canned sample brief and mock (LLM-free) copy instead of a user's business
 * and an LLM call. This is a review tool, not a generation: the point is to let an admin see the
 * real composition/layout/motion before approving a recipe into the live catalog, in a few
 * seconds, with zero LLM dependency so it always works regardless of provider config.
 */
import type { ExpandedBrief, PageBlueprint, SiteContext } from "../types.js";
import type { SiteSkin } from "../skins/schema.js";
import { GENERIC_THEME } from "../agents/theme-agent.js";
import type { VerticalProfileId } from "../design/vertical-profiles.js";
import { applySkinToContext, emptySitePlan } from "../skins/theme.js";
import { initSiteContext } from "../site-context/assemble.js";
import { mockFillSkinCopy, instancesFromSkinCopy, skinInstancesToBlueprints } from "../agents/skin-fill-agent.js";
import { MediaRegistry } from "../media/media-registry.js";
import { assembleReactPages, directorQaFrom } from "../orchestrator/react-pipeline.js";
import { generateReactProject, buildReactProject } from "../react-codegen/assemble-project.js";

/** One representative sample business per visual family — enough to see real composition and
 *  tone without needing an LLM. Keyed by the same 5 ids a `SiteSkin.visualFamily` already uses,
 *  so picking one is a direct lookup, not a guess. */
const SAMPLE_BRIEFS: Record<VerticalProfileId, ExpandedBrief> = {
  "luxury-dark": {
    businessName: "Lumière Studio",
    tagline: "Where every detail is considered.",
    elevatorPitch: "An appointment-only styling studio for clients who want a considered, personal experience.",
    expandedBrief:
      "Lumière Studio is an appointment-only styling studio. The team works with a small roster of clients at a time, pairing premium product partnerships with a calm, private space. Every visit is treated as a considered experience, not a transaction.",
    targetAudience: "clients who want a considered, personal experience",
    services: ["Signature styling", "Private consultations", "Bridal & event styling"],
    differentiators: ["By-appointment only", "Award-winning creative team", "Premium product partnerships"],
    tone: "intimate, refined, quietly confident",
    primaryCta: "Reserve your visit",
  },
  "clinical-light": {
    businessName: "Northgate Health Partners",
    tagline: "Straightforward care, close to home.",
    elevatorPitch: "A neighborhood practice offering dependable, unhurried care with same-day availability.",
    expandedBrief:
      "Northgate Health Partners is a neighborhood practice built around dependable, unhurried care. The board-certified team keeps pricing transparent, accepts most insurance, and holds same-day slots open every day for patients who need to be seen quickly.",
    targetAudience: "patients who want dependable, unhurried care",
    services: ["Preventive checkups", "Same-day appointments", "Specialist referrals"],
    differentiators: ["Board-certified team", "Transparent pricing", "Most insurance accepted"],
    tone: "reassuring, clear, professional",
    primaryCta: "Book an appointment",
  },
  "corporate-light": {
    businessName: "Ashford & Vale",
    tagline: "Clear thinking for complex decisions.",
    elevatorPitch: "An advisory firm that pairs senior judgment with data-backed recommendations for growth-stage companies.",
    expandedBrief:
      "Ashford & Vale has spent two decades advising growth-stage companies through strategy, financial planning, and risk & compliance work. Every client gets a dedicated account team and recommendations grounded in data, not guesswork.",
    targetAudience: "leadership teams navigating growth or change",
    services: ["Strategic advisory", "Financial planning", "Risk & compliance"],
    differentiators: ["20+ years advising growth-stage companies", "Dedicated account teams", "Data-backed recommendations"],
    tone: "assured, precise, outcome-focused",
    primaryCta: "Request a consultation",
  },
  "editorial-light": {
    businessName: "Studio Aday",
    tagline: "Ideas, made real.",
    elevatorPitch: "An independent design studio doing brand identity and art direction for founders who want to look as good as they are.",
    expandedBrief:
      "Studio Aday is a small, independent studio — senior team only, no account layers. The work spans brand identity, art direction, and editorial design, shown in both print and screen. A deliberately small roster means every client gets full attention.",
    targetAudience: "founders and brands who want to look as good as they are",
    services: ["Brand identity", "Art direction", "Editorial design"],
    differentiators: ["Independent studio, senior team only", "Work shown in print and screen", "Small roster, full attention"],
    tone: "editorial, confident, a little irreverent",
    primaryCta: "Start a project",
  },
  "warm-consumer": {
    businessName: "Marigold & Co.",
    tagline: "Good food, good company, every day.",
    elevatorPitch: "A family-owned neighborhood restaurant serving a seasonal menu to regulars who treat it like a second home.",
    expandedBrief:
      "Marigold & Co. has been family-owned since day one. The kitchen runs a seasonal menu built on locally sourced ingredients, hosts private events, and keeps weekend brunch going for the regulars who show up every week.",
    targetAudience: "neighbors looking for a place that feels like home",
    services: ["Seasonal menu", "Private events", "Weekend brunch"],
    differentiators: ["Locally sourced ingredients", "Family-owned since day one", "Loved by regulars"],
    tone: "warm, welcoming, energetic",
    primaryCta: "Reserve a table",
  },
};

export function sampleBriefFor(skin: SiteSkin): ExpandedBrief {
  return SAMPLE_BRIEFS[skin.visualFamily] ?? SAMPLE_BRIEFS["warm-consumer"];
}

/** Builds a fully-formed, LLM-free `SiteContext` for `skin` from the skin itself — visual family,
 *  chrome, and motion — not from a brief-regex vertical profile or a design-language overlay. */
function buildPreviewContext(skin: SiteSkin): { ctx: SiteContext; brief: ExpandedBrief } {
  const brief = sampleBriefFor(skin);
  const ctx = initSiteContext(brief.expandedBrief, brief, emptySitePlan(), { ...GENERIC_THEME });
  applySkinToContext(ctx, skin);
  return { ctx, brief };
}

export interface SkinPreviewResult {
  buildSucceeded: boolean;
  outPath?: string;
  buildError?: string;
  businessName: string;
  sectionsByPage: Record<string, string[]>;
}

/** Mock-fills `skin`, assembles it through the same page-assembly logic a real skin-fill
 *  generation uses, then runs it through the real Next.js codegen + static export build. Reuses
 *  `outputDir` across calls (pass `{ reuseProject: true }`) so repeat previews skip `npm install`
 *  and only pay for the Next.js build itself. */
export async function renderSkinPreview(
  skin: SiteSkin,
  outputDir: string,
  options: { basePath?: string; reuseProject?: boolean } = {}
): Promise<SkinPreviewResult> {
  const { ctx, brief } = buildPreviewContext(skin);

  const registry = new MediaRegistry();
  const copy = mockFillSkinCopy(ctx, skin);
  const instances = await instancesFromSkinCopy(ctx, skin, copy, registry, { enrichMedia: true });
  const blueprints: PageBlueprint[] = skinInstancesToBlueprints(skin, instances);

  directorQaFrom(ctx, blueprints, instances, skin);

  const pageRows = ctx.sitePlan.pages.map((page) => ({
    blueprint: blueprints.find((bp) => bp.slug === page.slug)!,
    instances: instances[page.slug] ?? [],
  }));
  const reactPages = assembleReactPages(ctx, pageRows);

  const sectionsByPage: Record<string, string[]> = {};
  for (const [slug, page] of Object.entries(reactPages)) {
    sectionsByPage[slug] = page.sections.map((s) => s.templateId);
  }

  const { projectPath } = await generateReactProject(ctx, reactPages, outputDir, {
    basePath: options.basePath,
    keepInstall: options.reuseProject,
  });

  try {
    const outPath = await buildReactProject(projectPath, { skipInstall: options.reuseProject });
    return { buildSucceeded: true, outPath, businessName: brief.businessName, sectionsByPage };
  } catch (err) {
    return {
      buildSucceeded: false,
      buildError: err instanceof Error ? err.message : String(err),
      businessName: brief.businessName,
      sectionsByPage,
    };
  }
}
