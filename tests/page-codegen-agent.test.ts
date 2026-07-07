import { describe, it, expect } from "vitest";
import {
  COMPONENT_MANIFEST,
  HERO_COMPONENT_NAMES,
  CONVERSION_COMPONENT_NAMES,
} from "../src/agents/component-manifest.js";
import {
  parsePageCodegenPlan,
  validatePageCodegenPlan,
} from "../src/agents/page-codegen-validate.js";
import {
  instancesToBlueprint,
  minimalBriefContext,
} from "../src/agents/page-codegen-agent.js";
import { SECTION_TEMPLATES } from "../src/section-templates/registry.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

function validHomePlan() {
  return {
    sections: [
      {
        component: "HeroSpotlight",
        intent: "Bold brand opening",
        props: {
          headline: "Linea Studio",
          subcopy: "Architecture for modern living",
          cta: { label: "View work", href: "/contact" },
        },
      },
      {
        component: "IntroStatement",
        intent: "Studio philosophy",
        props: {
          headline: "Spaces that breathe",
          body: "We design homes rooted in light and proportion.",
        },
      },
      {
        component: "FeatureBento",
        intent: "Core services",
        props: {
          headline: "What we do",
          items: [
            { title: "Residential", description: "Custom homes" },
            { title: "Renovation", description: "Thoughtful updates" },
          ],
        },
      },
      {
        component: "FooterCta",
        intent: "Book a consultation",
        props: {
          headline: "Start your project",
          cta: { label: "Book consultation", href: "/contact" },
        },
      },
    ],
  };
}

describe("page codegen agent", () => {
  it("manifest covers every registry component", () => {
    const manifestNames = new Set(COMPONENT_MANIFEST.map((e) => e.componentName));
    for (const t of SECTION_TEMPLATES) {
      expect(manifestNames.has(t.componentName)).toBe(true);
    }
  });

  it("validates a well-formed home plan", () => {
    const plan = parsePageCodegenPlan(validHomePlan());
    expect(validatePageCodegenPlan(plan, "home")).toBeNull();
  });

  it("rejects unknown components", () => {
    const plan = parsePageCodegenPlan({
      sections: [
        { component: "FakeHero", intent: "x", props: { headline: "Hi" } },
        { component: "FeatureBento", intent: "y", props: { headline: "H", items: [] } },
        { component: "IntroStatement", intent: "z", props: { headline: "H", body: "B" } },
      ],
    });
    expect(validatePageCodegenPlan(plan, "about")).toMatch(/unknown component/);
  });

  it("rejects multiple conversion closers", () => {
    const base = validHomePlan().sections;
    const plan = parsePageCodegenPlan({
      sections: [
        ...base.slice(0, 3),
        {
          component: "CtaBand",
          intent: "Convert",
          props: { headline: "Let's talk", cta: { label: "Contact", href: "/contact" } },
        },
        {
          component: "FooterCta",
          intent: "Also convert",
          props: { headline: "Start now", cta: { label: "Go", href: "/contact" } },
        },
      ],
    });
    expect(validatePageCodegenPlan(plan, "home")).toMatch(/at most one conversion/);
  });

  it("requires hero first on home", () => {
    const plan = parsePageCodegenPlan({
      sections: [
        {
          component: "IntroStatement",
          intent: "Open",
          props: { headline: "Hi", body: "There" },
        },
        {
          component: "HeroSpotlight",
          intent: "Hero",
          props: { headline: "Late hero" },
        },
        {
          component: "FeatureBento",
          intent: "Features",
          props: { headline: "F", items: [{ title: "A", description: "B" }] },
        },
        {
          component: "FooterCta",
          intent: "Close",
          props: { headline: "Go", cta: { label: "Go", href: "/contact" } },
        },
      ],
    });
    expect(validatePageCodegenPlan(plan, "home")).toMatch(/first section must be a hero/);
  });

  it("maps instances to blueprint ids", () => {
    const blueprint = instancesToBlueprint("home", [
      {
        id: "home_s0_herospotlight",
        templateId: "hero_spotlight",
        intent: "Open",
        props: { headline: "Linea Studio" },
      },
    ]);
    expect(blueprint.slug).toBe("home");
    expect(blueprint.sections[0]?.templateId).toBe("hero_spotlight");
  });

  it("minimal brief context omits expanded brief wall", () => {
    const brief = {
      businessName: "Linea Studio",
      tagline: "Architecture",
      elevatorPitch: "Residential architecture studio in Austin",
      expandedBrief: "A very long expanded brief ".repeat(40),
      targetAudience: "Homeowners",
      services: ["Design"],
      differentiators: ["Light"],
      tone: "Refined",
      primaryCta: "Book consultation",
    };
    const ctx = initSiteContext("Architecture", brief, mockPlan(brief), {
      vertical: "architecture",
      mood: "editorial",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#111",
        surface: "#1a1a1a",
        text: "#fff",
        muted: "#999",
        accent: "#c9a96e",
        accentSoft: "#2a2a2a",
        gradientFrom: "#c9a96e",
        gradientTo: "#8b7355",
        navBg: "#111",
      },
    });
    const text = minimalBriefContext(ctx);
    expect(text).toContain("Linea Studio");
    expect(text).toContain("Book consultation");
    expect(text.length).toBeLessThan(600);
    expect(text).not.toContain("A very long expanded brief ".repeat(10));
  });

  it("hero and conversion name sets match manifest", () => {
    for (const name of HERO_COMPONENT_NAMES) {
      expect(COMPONENT_MANIFEST.some((e) => e.componentName === name)).toBe(true);
    }
    for (const name of CONVERSION_COMPONENT_NAMES) {
      expect(COMPONENT_MANIFEST.some((e) => e.componentName === name)).toBe(true);
    }
  });
});
