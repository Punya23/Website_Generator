import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateCustomHeroSection,
  sanitizeCustomHeroSource,
  shouldCodegenCustomHero,
  validateCustomHeroSource,
  checkCustomHeroSyntax,
} from "../src/agents/section-codegen-agent.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

describe("section-codegen-agent", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    process.env = env;
  });

  const brief = {
    businessName: "Dstyle",
    tagline: "Modern elegance",
    elevatorPitch: "Fashion house",
    expandedBrief: "Editorial fashion.",
    targetAudience: "Women",
    services: ["Bridal"],
    differentiators: ["Craft"],
    tone: "Elegant",
    primaryCta: "Book consultation",
    secondaryCta: "View collections",
  };

  it("enables custom hero only when CUSTOM_HERO_CODEGEN=1", () => {
    const prev = process.env.CUSTOM_HERO_CODEGEN;
    process.env.CUSTOM_HERO_CODEGEN = "1";
    const ctx = initSiteContext("Fashion", brief, mockPlan(brief), {
      vertical: "fashion",
      mood: "editorial luxe",
      fontHeading: "Playfair Display",
      fontBody: "Inter",
      accentRole: "editorial",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#e85d04",
        accentSoft: "#fff7ed",
        gradientFrom: "#e85d04",
        gradientTo: "#f48c06",
        navBg: "#fff",
        navText: "#111",
        navMuted: "#666",
        navActiveBg: "#e85d04",
        navActiveText: "#fff",
      },
    });
    ctx.sitePlan.visualArchetype = "editorial fashion";

    expect(
      shouldCodegenCustomHero(ctx, "home", { id: "home_hero", templateId: "hero_editorial" }, 0)
    ).toBe(true);
    expect(
      shouldCodegenCustomHero(ctx, "about", { id: "about_hero", templateId: "hero_editorial" }, 0)
    ).toBe(false);

    delete process.env.CUSTOM_HERO_CODEGEN;
    if (prev !== undefined) process.env.CUSTOM_HERO_CODEGEN = prev;

    expect(
      shouldCodegenCustomHero(ctx, "home", { id: "home_hero", templateId: "hero_editorial" }, 0)
    ).toBe(false);
  });

  it("validates custom hero source sandbox rules", () => {
    const bad = validateCustomHeroSource(`export default function X() { return null; }`);
    expect(bad).toBeTruthy();

    const good = validateCustomHeroSource(`"use client";
import { Reveal } from "@/components/primitives";
export default function CustomHomeHero() { return <Reveal>Hi</Reveal>; }`);
    expect(good).toBeNull();
  });

  it("strips duplicate bare use client directives from LLM output", () => {
    const raw = `"use client";\n\nuse client;\nimport { Reveal } from "@/components/primitives";\nexport default function CustomHomeHero() { return <Reveal>Hi</Reveal>; }`;
    const fixed = sanitizeCustomHeroSource(raw);
    expect(fixed).not.toMatch(/^use client\s*;/m);
    expect(fixed.startsWith('"use client";')).toBe(true);
    expect(validateCustomHeroSource(fixed)).toBeNull();
  });

  it("rejects invalid primitive props from LLM output", () => {
    const bad = `"use client";\nimport { SectionLabel } from "@/components/primitives";\ntype HeroProps = { headline?: string };\nexport default function CustomHomeHero(props: HeroProps) { return <SectionLabel className="x">Hi</SectionLabel>; }`;
    expect(validateCustomHeroSource(bad)).toContain("SectionLabel");
  });

  it("adds HeroProps type when LLM omits props annotation", () => {
    const raw = `"use client";\nimport { Reveal } from "@/components/primitives";\nexport default function CustomHomeHero(props) { return <Reveal>Hi</Reveal>; }`;
    const fixed = sanitizeCustomHeroSource(raw);
    expect(fixed).toContain("type HeroProps");
    expect(fixed).toContain("CustomHomeHero(props: HeroProps)");
    expect(validateCustomHeroSource(fixed)).toBeNull();
  });

  it("strips invalid named React imports from LLM output", () => {
    const raw = `"use client";
import { motion } from 'framer-motion';
import { Reveal } from "@/components/primitives";
import { React } from 'react';

type HeroProps = { id?: string; headline?: string };
export default function CustomHomeHero(props: HeroProps) {
  return <Reveal>{props.headline}</Reveal>;
}`;
    const fixed = sanitizeCustomHeroSource(raw);
    expect(fixed).not.toMatch(/import\s+\{\s*React\s*\}/);
    expect(validateCustomHeroSource(fixed)).toBeNull();
    expect(checkCustomHeroSyntax(fixed)).toBeNull();
  });

  it("rejects unsafe props.cta access without optional chaining", () => {
    const bad = `"use client";
import { PrimaryButton, Reveal } from "@/components/primitives";
type HeroProps = { id?: string; cta?: { label: string; href?: string } };
export default function CustomHomeHero(props: HeroProps) {
  return <Reveal><PrimaryButton href={props.cta.href}>{props.cta.label}</PrimaryButton></Reveal>;
}`;
    expect(validateCustomHeroSource(bad)).toContain("props.cta");
  });

  it("repairs truncated HeroProps left by nested object fields", () => {
    const truncated = `"use client";
import { Reveal } from "@/components/primitives";

type HeroProps = {
  id?: string;
  label?: string;
  headline?: string;
  subcopy?: string;
  body?: string;
  image?: { src?: string; alt?: string };
};
  video?: { poster?: { src?: string; alt?: string } };
  cta?: { label: string; href?: string };
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
  mediaPosition?: "background" | "left" | "right";
};

export default function CustomHomeHero(props: HeroProps) {
  return <Reveal>{props.headline}</Reveal>;
}`;
    expect(validateCustomHeroSource(truncated)).toContain("Orphan");
    const fixed = sanitizeCustomHeroSource(truncated);
    expect(fixed).toContain("video?: { poster?: { src?: string; alt?: string } }");
    expect(fixed).not.toMatch(/\};\s*\n\s*\};\s*\n/);
    expect(validateCustomHeroSource(fixed)).toBeNull();
    expect(checkCustomHeroSyntax(fixed)).toBeNull();
  });

  it("rejects orphan HeroProps fields left by truncated replacement", () => {
    const broken = `"use client";
import { Reveal } from "@/components/primitives";

type HeroProps = {
  id?: string;
  image?: { src?: string; alt?: string };
};
  video?: { poster?: { src?: string; alt?: string } };

export default function CustomHomeHero(props: HeroProps) {
  return <Reveal>Hi</Reveal>;
}`;
    expect(validateCustomHeroSource(broken)).toContain("Orphan");
    const fixed = sanitizeCustomHeroSource(broken);
    expect(validateCustomHeroSource(fixed)).toBeNull();
  });

  it("accepts hero source after use client is prepended", () => {
    const source = `"use client";\nimport { Reveal } from "@/components/primitives";\nexport default function CustomHomeHero() { return <Reveal>Hi</Reveal>; }`;
    expect(validateCustomHeroSource(source)).toBeNull();
  });

  it("generates mock custom hero when LLM unavailable", async () => {
    vi.resetModules();
    const { generateCustomHeroSection: generateHero } = await import(
      "../src/agents/section-codegen-agent.js"
    );
    const ctx = initSiteContext("Fashion", brief, mockPlan(brief), {
      vertical: "fashion",
      mood: "editorial",
      fontHeading: "Playfair Display",
      fontBody: "Inter",
      accentRole: "editorial",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#e85d04",
        accentSoft: "#fff7ed",
        gradientFrom: "#e85d04",
        gradientTo: "#f48c06",
        navBg: "#fff",
        navText: "#111",
        navMuted: "#666",
        navActiveBg: "#e85d04",
        navActiveText: "#fff",
      },
    });

    const result = await generateHero(ctx, {
      id: "home_hero",
      templateId: "hero_editorial",
      intent: "Hero",
      props: {
        headline: "Elevating Tradition",
        subcopy: "Modern elegance",
        cta: { label: "Book", href: "/contact" },
      },
    });

    expect(result?.componentName).toBe("CustomHomeHero");
    expect(result?.source).toContain("export default function CustomHomeHero");
    expect(validateCustomHeroSource(result!.source)).toBeNull();
  });
});
