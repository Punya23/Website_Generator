/** Chrome Director — footer layout, link groups, and nav chrome strategy. */
import type { ChromeSpec, PageBlueprint, SiteContext } from "../types.js";
import { ChromeSpecSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm, handleLlmFailure } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { pipelineLog } from "../util/pipeline-log.js";
import {
  freezeSnapshot,
  type ChromeDirectorSnapshot,
  validateAgentOutput,
  type AgentContract,
} from "./contracts/index.js";

const CHROME_CONTRACT: AgentContract<ChromeSpec> = {
  name: "ChromeDirector",
  role: "Output site chrome (footer + nav behavior) only — never section props or colors.",
  outputSchema: ChromeSpecSchema,
  forbiddenFields: ["colors", "templateId", "props", "gradientFrom", "fontHeading"],
};

const CHROME_PROMPT = `You are a site chrome director for premium marketing websites.

INPUT (read-only): business brief, page list, design mood, page blueprints.
OUTPUT (your only job): ChromeSpec JSON for footer and nav chrome.
FORBIDDEN: Do not output colors, fonts, section templates, or section copy.

Footer rules:
- layout: two-column (brand left, links right) for editorial brands; centered for minimal; cta-heavy for conversion-focused
- tagline: compelling one-liner from brief (not raw elevator pitch)
- linkGroups: optional grouped nav (e.g. "Explore", "Company") with page slugs
- ctaLabel + ctaHref: primary conversion action
- showMood: true for fashion/editorial, false for corporate

Nav rules:
- compactOnScroll: true for glass/solid nav treatments
- shadowOnScroll: true when design feels elevated
- luxury-dark: include announcement bar; clinical-light: omit announcement (trust-first, minimal chrome)
- luxury-dark / editorial-light: grainOverlay true in immersive; clinical/corporate: grainOverlay false

Output JSON only:
{
  "footer": {
    "layout": "two-column|centered|cta-heavy",
    "tagline": "...",
    "linkGroups": [{ "label": "Explore", "slugs": ["home", "services"] }],
    "ctaLabel": "...",
    "ctaHref": "/contact",
    "showMood": true
  },
  "nav": { "compactOnScroll": true, "shadowOnScroll": true }
}`;

function mockChromeSpec(ctx: SiteContext, blueprints: PageBlueprint[]): ChromeSpec {
  const slugs = blueprints.map((b) => b.slug);
  const profile = ctx.verticalProfile?.profileId;
  const isEditorial =
    ctx.designSystem.accentRole === "editorial" ||
    ctx.sitePlan.visualArchetype?.toLowerCase().includes("editorial") ||
    ctx.sitePlan.visualArchetype?.toLowerCase().includes("fashion") ||
    profile === "editorial-light";
  const isLuxuryDark = profile === "luxury-dark";

  return {
    footer: {
      layout: isEditorial ? "two-column" : "cta-heavy",
      tagline: ctx.expandedBrief.tagline,
      linkGroups: [
        { label: "Explore", slugs: slugs.filter((s) => s !== "contact").slice(0, 4) },
        { label: "Connect", slugs: ["contact"] },
      ],
      ctaLabel: ctx.expandedBrief.primaryCta,
      ctaHref: "/contact",
      showMood: Boolean(isEditorial || isLuxuryDark),
    },
    nav: {
      compactOnScroll: ctx.designSystem.navTreatment !== "minimal",
      shadowOnScroll: true,
    },
    announcement: isLuxuryDark
      ? {
          message: ctx.expandedBrief.secondaryCta ?? ctx.expandedBrief.tagline,
          href: "/contact",
        }
      : profile === "clinical-light"
        ? undefined
        : {
            message: ctx.expandedBrief.secondaryCta ?? ctx.expandedBrief.tagline,
            href: "/contact",
          },
    stickyMobileCta: {
      label: ctx.expandedBrief.primaryCta,
      href: "/contact",
    },
    newsletter: {
      headline: "Join our newsletter",
      subcopy: ctx.expandedBrief.tagline,
      buttonLabel: "Subscribe",
    },
    immersive: {
      smoothScroll: true,
      grainOverlay: ctx.verticalProfile?.grainOverlay ?? (isEditorial || isLuxuryDark),
    },
  };
}

function mergeChromeProfileDefaults(
  spec: ChromeSpec,
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): ChromeSpec {
  const defaults = mockChromeSpec(ctx, blueprints);
  return ChromeSpecSchema.parse({
    ...defaults,
    ...spec,
    footer: { ...defaults.footer, ...spec.footer },
    nav: { ...defaults.nav, ...spec.nav },
    announcement: spec.announcement ?? defaults.announcement,
    stickyMobileCta: spec.stickyMobileCta ?? defaults.stickyMobileCta,
    newsletter: spec.newsletter ?? defaults.newsletter,
    immersive: { ...defaults.immersive, ...spec.immersive },
  });
}

export async function directChromeSpec(
  ctx: SiteContext,
  blueprints: PageBlueprint[]
): Promise<ChromeSpec> {
  const snapshot = freezeSnapshot<ChromeDirectorSnapshot>({
    businessName: ctx.businessName,
    brief: ctx.expandedBrief,
    sitePlan: ctx.sitePlan,
    designSystem: ctx.designSystem,
    blueprints,
    verticalProfile: ctx.verticalProfile,
    variationSeed: ctx.variationSeed,
  });

  if (llm.isAvailable) {
    try {
      const pages = ctx.sitePlan.pages
        .map((p) => `- ${p.slug}: ${p.navLabel ?? p.title} (${p.goal})`)
        .join("\n");

      const raw = await llm.chat(
        CHROME_PROMPT,
        `Business: ${snapshot.businessName}
Tagline: ${snapshot.brief.tagline}
Primary CTA: ${snapshot.brief.primaryCta}
Mood: ${snapshot.designSystem.mood}
Nav treatment: ${snapshot.designSystem.navTreatment ?? "solid"}
Vertical profile: ${ctx.verticalProfile?.profileId ?? "generic"}
Page tone: ${ctx.designSystem.pageTone ?? "light"}
Grain overlay default: ${ctx.verticalProfile?.grainOverlay ? "true" : "false"}

Pages:
${pages}`,
        { jsonMode: true, temperature: 0.5, tokenRole: "design" }
      );

      const spec = mergeChromeProfileDefaults(
        validateAgentOutput(CHROME_CONTRACT, parseLlmJson(raw)),
        ctx,
        blueprints
      );
      pipelineLog(`[pipeline] Chrome director: footer ${spec.footer.layout}`);
      return spec;
    } catch (err) {
      if (!allowMocks()) handleLlmFailure("chrome director", err);
      recordFallback("chrome_director");
    }
  } else {
    if (!allowMocks()) requireLlm("chrome director");
  }

  return mockChromeSpec(ctx, blueprints);
}
