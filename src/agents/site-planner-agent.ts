import type { ExpandedBrief, SitePlan } from "../types.js";
import { SitePlanSchema } from "../types.js";
import { CORE_PAGE_KINDS } from "../types.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { detectVertical } from "./theme-agent.js";

const PLANNER_SYSTEM = `You are a website information architect. Given an expanded business brief, design a UNIQUE site structure.

Output valid JSON:
{
  "pages": [
    {
      "slug": "home|about|services|contact|team|pricing|faq|gallery",
      "title": "Page title",
      "goal": "what this page must accomplish",
      "minBlocks": 18-30,
      "layoutHint": "specific layout personality for THIS page — e.g. 'full-bleed hero alone, then asymmetric gallery, no card-wrapped headers'",
      "contentFocus": ["3-6 topics this page must cover in depth"]
    }
  ],
  "compositionStrategy": "1-2 sentences: how this site's layout should DIFFER from a generic template",
  "avoidPatterns": ["patterns to avoid for this business e.g. 'stats grid on salon homepage'"],
  "visualArchetype": "e.g. editorial-magazine | trust-dashboard | energy-bento | warm-storytelling",
  "motionStyle": "e.g. staggered reveals + parallax hero | subtle fade | bold scale-in"
}

RULES:
- ALWAYS include: home, about, services, contact
- ADD 0-2 optional pages (team, pricing, faq, gallery) only if the business needs them
- Salon/beauty: prefer gallery page or team page, visual-first layouts, NEVER put hero headline inside a card row
- Finserv: trust-first, lead with stats row after hero, long-form text sections, avoid heavy galleries
- Restaurant: menu-focused services, warm imagery, alternating image+text rows
- Fitness/gym: energy-bento archetype — asymmetric image mosaic, stats band, class cards in 2-col, dark cinematic hero
- Each page needs minBlocks 18+ on home/services, 14+ on about/contact
- layoutHint must be SPECIFIC and DIFFERENT per business — not copy-paste structures
- motionStyle should match vertical (fitness=bold scale-in, finserv=subtle fade)`;

function mockPlan(brief: ExpandedBrief): SitePlan {
  const v = detectVertical(`${brief.expandedBrief} ${brief.services.join(" ")}`);

  const basePages = [
    {
      slug: "home",
      title: "Home",
      goal: "Convert visitors with emotional hook and clear CTA",
      minBlocks: v === "finserv" ? 22 : 24,
      layoutHint:
        v === "salon"
          ? "Full-bleed hero ONLY (no row). Gallery grid 3-col. Features as horizontal scroll feel via row. Testimonials stacked with large quotes. CTA full-bleed."
          : v === "finserv"
            ? "Full-bleed hero. Stats in tight Row immediately below. Two-column text+image for story. Feature grid 2-col. Testimonial band. CTA full-bleed."
            : "Full-bleed hero. Alternating Section stacks. Mixed grid sizes.",
      contentFocus: ["hero value prop", "social proof", "key services", "testimonials", "cta"],
    },
    {
      slug: "about",
      title: "About",
      goal: "Build trust with story, team, values",
      minBlocks: 16,
      layoutHint:
        v === "salon"
          ? "Section headline (no card). Story text wide. Image gallery row. Team values grid."
          : "Section headline. Timeline-style text stack. Credentials stats row. Image sidebar row.",
      contentFocus: ["origin story", "mission", "team expertise", "values"],
    },
    {
      slug: "services",
      title: v === "finserv" ? "Services" : "Services",
      goal: "Detail every offering with depth",
      minBlocks: 20,
      layoutHint:
        v === "salon"
          ? "No card headline. Service categories as feature grid. Large gallery section. Pricing hints as stats."
          : v === "fitness"
            ? "Bento mosaic: mix 2-col and 3-col gallery grids. Class features in wide grid. Stats in horizontal band Row."
            : "Service pillars as 2-col grid. Each with detail text block. Process steps stack.",
      contentFocus: brief.services.slice(0, 6),
    },
    {
      slug: "contact",
      title: "Contact",
      goal: "Remove friction to reach out",
      minBlocks: 14,
      layoutHint: "Section headline. Contact block + map image row. FAQ text stack. Full-bleed CTA.",
      contentFocus: ["contact info", "hours", "booking", "location"],
    },
  ];

  const optional =
    v === "salon"
      ? [
          {
            slug: "team",
            title: "Our Team",
            goal: "Showcase stylists and build personal connection",
            minBlocks: 16,
            layoutHint: "Gallery-forward grid of team members. No uniform card rows.",
            contentFocus: ["lead stylists", "specialties", "awards"],
          },
        ]
      : v === "finserv"
        ? [
            {
              slug: "faq",
              title: "FAQ",
              goal: "Address objections and compliance questions",
              minBlocks: 14,
              layoutHint: "Stack of text Q&A blocks. Stats trust bar at top.",
              contentFocus: ["fees", "fiduciary", "minimums", "process"],
            },
          ]
        : [];

  return SitePlanSchema.parse({
    pages: [...basePages, ...optional],
    compositionStrategy:
      v === "salon"
        ? "Visual editorial magazine layout — heroes bleed edge-to-edge, headers never in cards, galleries dominate"
        : v === "finserv"
          ? "Institutional trust layout — data-forward, generous whitespace, narrative text columns, restrained imagery"
          : v === "fitness"
            ? "High-energy bento layout — cinematic full-bleed hero, stats band, asymmetric class/gallery mosaic, bold CTAs"
            : "Balanced storytelling with alternating full-width and contained sections",
    visualArchetype:
      v === "salon"
        ? "editorial-magazine"
        : v === "finserv"
          ? "trust-dashboard"
          : v === "fitness"
            ? "energy-bento"
            : "warm-storytelling",
    motionStyle:
      v === "fitness"
        ? "bold scale-in reveals, parallax hero, staggered grid cards"
        : v === "finserv"
          ? "subtle fade-up, minimal motion"
          : "staggered reveals with soft ease",
    avoidPatterns:
      v === "salon"
        ? ["hero in row with image", "identical 3-stat grid like finance site", "card-wrapped page titles"]
        : v === "fitness"
          ? ["uniform 3-col feature grid", "hero beside image in row", "tiny stat cards", "card-wrapped headers"]
          : ["large image gallery grid", "casual testimonial tone", "card-wrapped headers"],
  });
}

export async function planSite(brief: ExpandedBrief): Promise<SitePlan> {
  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        PLANNER_SYSTEM,
        briefToContext(brief),
        { jsonMode: true, temperature: 0.6, maxTokens: 4096, model: llm.getCompositionModel() }
      );
      const plan = SitePlanSchema.parse(JSON.parse(raw));
      const slugs = new Set(plan.pages.map((p) => p.slug));
      for (const core of CORE_PAGE_KINDS) {
        if (!slugs.has(core)) {
          return mockPlan(brief);
        }
      }
      return plan;
    } catch {
      // fallback
    }
  }
  return mockPlan(brief);
}

export function getPagePlan(plan: SitePlan, slug: string) {
  return plan.pages.find((p) => p.slug === slug);
}
