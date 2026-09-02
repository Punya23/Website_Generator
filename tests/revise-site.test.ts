import { describe, expect, it } from "vitest";
import type { ReactPage, SiteContext } from "../src/types.js";
import {
  applyRevision,
  parseRevisionPatch,
  pageBounds,
} from "../src/editor/apply-revision.js";
import { detectHardRefuse } from "../src/agents/revise-site-agent.js";
import { inspectIngestUrl } from "../src/admin/policy.js";
import { mockPropsForTemplate } from "../src/agents/section-props-shared.js";

const brief = {
  businessName: "ClearSmile Dental",
  tagline: "Family dentistry",
  elevatorPitch: "Gentle family dentistry with same-week appointments.",
  expandedBrief: "ClearSmile Dental is a family dentistry clinic.",
  targetAudience: "Local families",
  services: ["Checkups", "Whitening", "Invisalign"],
  differentiators: ["Same-week appointments", "Gentle care", "Modern chairs"],
  tone: "Calm",
  primaryCta: "Book a visit",
};

function section(
  id: string,
  templateId: string,
  intent: string
): ReactPage["sections"][number] {
  return {
    id,
    templateId,
    intent,
    props: mockPropsForTemplate(templateId, { id, templateId, intent }, brief, "home"),
  };
}

function mockCtx(): SiteContext {
  return {
    businessName: "ClearSmile Dental",
    businessBrief: "Family dentistry",
    expandedBrief: brief,
    sitePlan: {
      pages: [
        {
          slug: "home",
          title: "Home",
          navLabel: "Home",
          goal: "Convert",
          minBlocks: 4,
          layoutHint: "hero",
          contentFocus: ["brand"],
        },
      ],
      compositionStrategy: "editorial",
      avoidPatterns: [],
      visualArchetype: "clinical",
      motionStyle: "stagger",
    },
    designSystem: {
      vertical: "health",
      mood: "clinical-light",
      fontHeading: "Inter",
      fontBody: "Inter",
      navShape: "full-width",
      colors: {
        bg: "#ffffff",
        surface: "#f7f7f5",
        text: "#171717",
        muted: "#6b6b66",
        accent: "#1d4ed8",
        accentSoft: "#e8eefc",
        gradientFrom: "#ffffff",
        gradientTo: "#e8eefc",
        navBg: "#ffffff",
      },
    },
    pages: {},
    reactPages: {
      home: {
        slug: "home",
        title: "Home",
        sections: [
          section("home_hero", "hero_editorial", "Open"),
          section("home_story", "story_split", "Story"),
          section("home_offer", "offer_index", "Services"),
          section("home_cta", "footer_cta", "Convert"),
        ],
      },
    },
    mediaRegistry: [],
  } as SiteContext;
}

describe("site revision patches", () => {
  it("parses fake LLM JSON for a theme patch", () => {
    const patch = parseRevisionPatch({
      kind: "theme",
      summary: "Warmer accent",
      theme: { colors: { accent: "#b45309" }, mood: "warm-consumer" },
    });
    expect(patch.kind).toBe("theme");
    expect(patch.theme?.colors?.accent).toBe("#b45309");
  });

  it("applies a theme color patch", () => {
    const ctx = mockCtx();
    const result = applyRevision(ctx, {
      kind: "theme",
      summary: "Warmer colors",
      theme: { colors: { accent: "#b45309" }, mood: "warm-consumer" },
    });
    expect(result.kind).toBe("theme");
    expect(ctx.designSystem.colors.accent).toBe("#b45309");
    expect(ctx.designSystem.mood).toBe("warm-consumer");
  });

  it("merges copy onto an existing section", () => {
    const ctx = mockCtx();
    applyRevision(ctx, {
      kind: "copy",
      summary: "Shorter hero",
      sectionId: "home_hero",
      props: { headline: "Smile sooner." },
    });
    expect(ctx.reactPages!.home.sections[0]!.props.headline).toBe("Smile sooner.");
  });

  it("inserts a library FAQ before the CTA and keeps page bounds", () => {
    const ctx = mockCtx();
    const before = ctx.reactPages!.home.sections.length;
    const result = applyRevision(ctx, {
      kind: "insert",
      summary: "Add FAQ",
      pageSlug: "home",
      templateId: "faq_accordion",
      intent: "Questions",
    });
    expect(result.kind).toBe("insert");
    const sections = ctx.reactPages!.home.sections;
    expect(sections.length).toBe(before + 1);
    expect(sections.length).toBeLessThanOrEqual(pageBounds("home").max);
    expect(sections.some((s) => s.templateId === "faq_accordion")).toBe(true);
    expect(sections.at(-1)?.templateId).toBe("footer_cta");
  });

  it("refuses ecommerce, backends, and cloning Framer", () => {
    expect(detectHardRefuse("Add a Shopify shopping cart and Stripe checkout")?.kind).toBe(
      "refuse"
    );
    expect(detectHardRefuse("Wire this up to Postgres and a FastAPI backend")?.kind).toBe(
      "refuse"
    );
    expect(detectHardRefuse("Clone https://framer.com/projects/foo")?.kind).toBe("refuse");
    expect(inspectIngestUrl("https://framer.com/projects/foo").ok).toBe(false);
    const ctx = mockCtx();
    const result = applyRevision(ctx, {
      kind: "refuse",
      summary: "No commerce",
      reason: "No store",
    });
    expect(result.kind).toBe("refuse");
    expect(ctx.reactPages!.home.sections).toHaveLength(4);
  });

  it("does not insert a second hero or an unknown template", () => {
    const ctx = mockCtx();
    expect(() =>
      applyRevision(ctx, {
        kind: "insert",
        summary: "Another hero",
        pageSlug: "home",
        templateId: "hero_statement",
      })
    ).toThrow(/swap to change the hero/i);
    expect(() =>
      applyRevision(ctx, {
        kind: "insert",
        summary: "Invented block",
        pageSlug: "home",
        templateId: "magic_carousel_9000",
      })
    ).toThrow(/unknown template/i);
  });
});
