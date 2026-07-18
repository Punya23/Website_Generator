/** Clean chrome/motion defaults for page-codegen — no grain, blur, or scroll gimmicks.
 *  Footer layout and nav scroll behavior still vary per site (seeded from variationSeed).
 *  Motion plan.chrome.nav is the sole runtime owner of nav scroll behavior. */
import type { ChromeSpec, PageBlueprint, SiteContext, SiteMotionPlan } from "../types.js";
import { defaultSectionMotion } from "./contracts/index.js";
import { pickFrom } from "../design/variation.js";

const FOOTER_LAYOUTS: ChromeSpec["footer"]["layout"][] = ["two-column", "centered", "cta-heavy"];
const FOOTER_SURFACES: NonNullable<ChromeSpec["footer"]["surface"]>[] = ["none", "subtle", "bordered"];

export function minimalChromeSpec(ctx: SiteContext, blueprints: PageBlueprint[]): ChromeSpec {
  const slugs = blueprints.map((b) => b.slug);
  const seed = ctx.variationSeed ?? ctx.businessName;
  const footerLayout = pickFrom(seed, "footer-layout", FOOTER_LAYOUTS);
  const footerSurface = pickFrom(seed, "footer-surface", FOOTER_SURFACES);

  return {
    footer: {
      layout: footerLayout,
      tagline: ctx.expandedBrief.tagline,
      // Split the nav into real columns (Explore / Company) instead of one thin "Pages" list — the
      // single-column footer is the "minimal/sparse footer" QA flag. A dedicated contact column
      // gives the footer a second anchor even on small sites.
      linkGroups: buildFooterLinkGroups(slugs),
      ctaLabel: ctx.expandedBrief.primaryCta,
      ctaHref: "/contact",
      showMood: footerLayout === "two-column",
      surface: footerSurface,
      divider: "line",
    },
    immersive: {
      smoothScroll: false,
      grainOverlay: false,
    },
  };
}

function buildFooterLinkGroups(slugs: string[]): Array<{ label: string; slugs: string[] }> {
  const main = slugs.filter((s) => s !== "contact");
  const hasContact = slugs.includes("contact");
  const groups: Array<{ label: string; slugs: string[] }> = [];

  if (main.length >= 4) {
    const half = Math.ceil(main.length / 2);
    groups.push({ label: "Explore", slugs: main.slice(0, half) });
    groups.push({ label: "Company", slugs: main.slice(half) });
  } else {
    groups.push({ label: "Explore", slugs: main });
  }
  if (hasContact) groups.push({ label: "Get in touch", slugs: ["contact"] });
  return groups;
}

/** Which axis an entrance animates on — reveal/stagger both move on Y, so they read as "the same
 *  animation" when stacked. Breaking the axis (X / scale / rest) is what kills the monotony flag. */
type MotionAxis = "y" | "x" | "scale" | "none";
function axisOf(entrance: string): MotionAxis {
  if (entrance === "slide-left") return "x";
  if (entrance === "scale-in") return "scale";
  if (entrance === "none") return "none";
  return "y"; // reveal, stagger
}

/** Preferred entrance per template role; the walk below rotates to a different axis when a run of
 *  the same axis would exceed 2 consecutive sections, and drops a `none` rest beat every ~4. */
function preferredEntrance(templateId: string): SiteMotionPlan["sections"][string]["entrance"] {
  if (templateId.startsWith("hero_")) return "none";
  if (["stats_marquee", "logo_marquee", "text_marquee", "stats_animated"].includes(templateId)) return "stagger";
  if (["cta_band", "footer_cta", "newsletter_band"].includes(templateId)) return "scale-in";
  if (["gallery_masonry", "horizontal_gallery", "portfolio_carousel", "portfolio_strip"].includes(templateId))
    return "slide-left";
  if (["testimonial_featured", "testimonial_carousel"].includes(templateId)) return "reveal";
  return "reveal";
}

const AXIS_BREAKERS: Array<SiteMotionPlan["sections"][string]["entrance"]> = ["slide-left", "scale-in"];

export function minimalMotionPlan(
  ctx: SiteContext,
  blueprints: PageBlueprint[],
  chrome?: ChromeSpec
): SiteMotionPlan {
  const seed = ctx.variationSeed ?? ctx.businessName;
  const compactOnScroll = pickFrom(seed, "nav-compact-on-scroll", [true, false]);
  const shadowOnScroll = true;
  const sections: SiteMotionPlan["sections"] = {};

  for (const bp of blueprints) {
    // Walk each page IN ORDER, tracking the running axis so no more than 2 consecutive sections
    // share it (the "4+ consecutive reveal entrances" QA flag was literally true before this).
    let runAxis: MotionAxis | null = null;
    let runLen = 0;
    let sinceRest = 0;
    let usedParallax = false;

    bp.sections.forEach((s, idx) => {
      const base = defaultSectionMotion(s.templateId);
      const isMarquee =
        s.templateId === "text_marquee" || s.templateId === "logo_marquee" || s.templateId === "stats_marquee";
      const isHero = s.templateId.startsWith("hero_");

      let entrance = isHero ? "none" : preferredEntrance(s.templateId);

      if (!isHero) {
        // Break a Y-axis run of 2 by rotating to a different-axis breaker.
        if (axisOf(entrance) === runAxis && runLen >= 2) {
          const breaker =
            AXIS_BREAKERS.find((b) => axisOf(b) !== runAxis) ??
            pickFrom(seed, `break:${s.id}`, AXIS_BREAKERS);
          entrance = breaker;
        }
        // A quiet "rest beat" every ~4 body sections so the page breathes.
        if (sinceRest >= 4 && idx < bp.sections.length - 1) {
          entrance = "reveal";
          sinceRest = 0;
        }
      }

      const axis = axisOf(entrance);
      if (axis === runAxis) runLen++;
      else {
        runAxis = axis;
        runLen = 1;
      }
      sinceRest = entrance === "none" ? 0 : sinceRest + 1;

      // At most one parallax per page (motion budget).
      const wantsParallax = isHero && !usedParallax && pickFrom(seed, `parallax:${s.id}`, [false, false, true]);
      if (wantsParallax) usedParallax = true;

      sections[s.id] = {
        ...base,
        entrance,
        parallax: wantsParallax,
        marquee: isMarquee,
      };
    });
  }

  void chrome;

  return {
    globalPreset: ctx.designSystem.motionPreset ?? "fade-up",
    reducedMotion: "respect",
    timing: {
      durationMs: pickFrom(seed, "motion-duration", [450, 550, 650, 750]),
      staggerMs: pickFrom(seed, "motion-stagger", [50, 60, 80, 100]),
      ease: pickFrom(seed, "motion-ease", ["out-expo", "out-quart"] as const),
    },
    sections,
    chrome: {
      footer: { entrance: pickFrom(seed, "footer-entrance", ["none", "stagger"] as const) },
      nav: { compactOnScroll, shadowOnScroll },
    },
  };
}
