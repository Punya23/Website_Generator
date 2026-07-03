import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateBespokeSection,
  sanitizeBespokeSource,
  shouldAttemptBespokeSection,
  validateBespokeSource,
  checkBespokeSyntax,
  inferPropsType,
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

  function makeCtx() {
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
    return ctx;
  }

  it("enables bespoke codegen for eligible section kinds only when BESPOKE_SECTION_CODEGEN=1, excludes interactive templates", () => {
    const prev = process.env.BESPOKE_SECTION_CODEGEN;
    process.env.BESPOKE_SECTION_CODEGEN = "1";
    const ctx = makeCtx();

    expect(shouldAttemptBespokeSection(ctx, { id: "home_hero", templateId: "hero_editorial" })).toBe(true);
    expect(shouldAttemptBespokeSection(ctx, { id: "home_bento", templateId: "feature_bento" })).toBe(true);
    expect(shouldAttemptBespokeSection(ctx, { id: "home_faq", templateId: "faq_accordion" })).toBe(false);
    expect(
      shouldAttemptBespokeSection(ctx, { id: "home_carousel", templateId: "testimonial_carousel" })
    ).toBe(false);

    process.env.BESPOKE_SECTION_CODEGEN = "0";
    expect(shouldAttemptBespokeSection(ctx, { id: "home_hero", templateId: "hero_editorial" })).toBe(false);

    delete process.env.BESPOKE_SECTION_CODEGEN;
    if (prev !== undefined) process.env.BESPOKE_SECTION_CODEGEN = prev;
  });

  it("validates bespoke source sandbox rules", () => {
    const bad = validateBespokeSource(`export default function X() { return null; }`, "TestProps");
    expect(bad).toBeTruthy();

    const good = validateBespokeSource(
      `"use client";
import { Reveal } from "@/components/primitives";
export default function CustomHomeHero() { return <Reveal>Hi</Reveal>; }`,
      "TestProps"
    );
    expect(good).toBeNull();
  });

  it("strips duplicate bare use client directives from LLM output", () => {
    const raw = `"use client";\n\nuse client;\nimport { Reveal } from "@/components/primitives";\nexport default function CustomHomeHero() { return <Reveal>Hi</Reveal>; }`;
    const fixed = sanitizeBespokeSource(raw, "TestProps", "type TestProps = {\n  id?: string;\n};");
    expect(fixed).not.toMatch(/^use client\s*;/m);
    expect(fixed.startsWith('"use client";')).toBe(true);
    expect(validateBespokeSource(fixed, "TestProps")).toBeNull();
  });

  it("rejects invalid primitive props from LLM output", () => {
    const bad = `"use client";\nimport { SectionLabel } from "@/components/primitives";\ntype TestProps = { headline?: string };\nexport default function CustomHomeHero(props: TestProps) { return <SectionLabel className="x">Hi</SectionLabel>; }`;
    expect(validateBespokeSource(bad, "TestProps")).toContain("SectionLabel");
  });

  it("adds the props type when LLM omits props annotation (non-hero section)", () => {
    const typeBlock = "type TestBentoProps = {\n  id?: string;\n  headline?: string;\n};";
    const raw = `"use client";\nimport { Reveal } from "@/components/primitives";\nexport default function CustomBento(props) { return <Reveal>Hi</Reveal>; }`;
    const fixed = sanitizeBespokeSource(raw, "TestBentoProps", typeBlock);
    expect(fixed).toContain("type TestBentoProps");
    expect(fixed).toContain("CustomBento(props: TestBentoProps)");
    expect(validateBespokeSource(fixed, "TestBentoProps")).toBeNull();
  });

  it("strips invalid named React imports from LLM output", () => {
    const raw = `"use client";
import { motion } from 'framer-motion';
import { Reveal } from "@/components/primitives";
import { React } from 'react';

type TestProps = { id?: string; headline?: string };
export default function CustomHomeHero(props: TestProps) {
  return <Reveal>{props.headline}</Reveal>;
}`;
    const fixed = sanitizeBespokeSource(
      raw,
      "TestProps",
      "type TestProps = {\n  id?: string;\n  headline?: string;\n};"
    );
    expect(fixed).not.toMatch(/import\s+\{\s*React\s*\}/);
    expect(validateBespokeSource(fixed, "TestProps")).toBeNull();
    expect(checkBespokeSyntax(fixed)).toBeNull();
  });

  it("rejects unsafe props.cta access without optional chaining", () => {
    const bad = `"use client";
import { PrimaryButton, Reveal } from "@/components/primitives";
type TestProps = { id?: string; cta?: { label: string; href?: string } };
export default function CustomHomeHero(props: TestProps) {
  return <Reveal><PrimaryButton href={props.cta.href}>{props.cta.label}</PrimaryButton></Reveal>;
}`;
    expect(validateBespokeSource(bad, "TestProps")).toContain("props.cta");
  });

  it("repairs truncated props type left by nested object fields", () => {
    const typeName = "TestProps";
    const truncated = `"use client";
import { Reveal } from "@/components/primitives";

type TestProps = {
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

export default function CustomHomeHero(props: TestProps) {
  return <Reveal>{props.headline}</Reveal>;
}`;
    expect(validateBespokeSource(truncated, typeName)).toContain("Orphan");
    const typeBlock = `type TestProps = {
  id?: string;
  label?: string;
  headline?: string;
  subcopy?: string;
  body?: string;
  image?: { src?: string; alt?: string };
  video?: { poster?: { src?: string; alt?: string } };
  cta?: { label: string; href?: string };
};`;
    const fixed = sanitizeBespokeSource(truncated, typeName, typeBlock);
    expect(fixed).toContain("video?: { poster?: { src?: string; alt?: string } }");
    expect(fixed).not.toMatch(/\};\s*\n\s*\};\s*\n/);
    expect(validateBespokeSource(fixed, typeName)).toBeNull();
    expect(checkBespokeSyntax(fixed)).toBeNull();
  });

  it("rejects orphan props type fields left by truncated replacement", () => {
    const typeName = "TestProps";
    const broken = `"use client";
import { Reveal } from "@/components/primitives";

type TestProps = {
  id?: string;
  image?: { src?: string; alt?: string };
};
  video?: { poster?: { src?: string; alt?: string } };

export default function CustomHomeHero(props: TestProps) {
  return <Reveal>Hi</Reveal>;
}`;
    expect(validateBespokeSource(broken, typeName)).toContain("Orphan");
    const typeBlock =
      "type TestProps = {\n  id?: string;\n  image?: { src?: string; alt?: string };\n  video?: { poster?: { src?: string; alt?: string } };\n};";
    const fixed = sanitizeBespokeSource(broken, typeName, typeBlock);
    expect(validateBespokeSource(fixed, typeName)).toBeNull();
  });

  it("accepts source after use client is prepended", () => {
    const source = `"use client";\nimport { Reveal } from "@/components/primitives";\nexport default function CustomHomeHero() { return <Reveal>Hi</Reveal>; }`;
    expect(validateBespokeSource(source, "TestProps")).toBeNull();
  });

  it("returns null (caller falls back to the fixed template) when LLM unavailable", async () => {
    vi.resetModules();
    const { generateBespokeSection: generate } = await import(
      "../src/agents/section-codegen-agent.js"
    );
    const ctx = makeCtx();

    const result = await generate(ctx, {
      id: "home_hero",
      templateId: "hero_editorial",
      intent: "Hero",
      props: {
        headline: "Elevating Tradition",
        subcopy: "Modern elegance",
        cta: { label: "Book", href: "/contact" },
      },
    });

    expect(result).toBeNull();
  });

  describe("inferPropsType with nested objects (regression)", () => {
    it("keeps nested object fields (cta, image) inline so the type has exactly one closing brace line", () => {
      const typeBlock = inferPropsType(
        {
          headline: "Headline",
          cta: { label: "Book", href: "/contact" },
          image: { src: "https://x/1.jpg", alt: "Alt" },
          items: [{ title: "A", description: "B" }],
        },
        "TestNestedProps"
      );

      const closingBraceLines = typeBlock.split("\n").filter((l) => l.trim() === "};");
      expect(closingBraceLines).toHaveLength(1);
      expect(typeBlock).toContain("cta?: { label?: string; href?: string };");
      expect(typeBlock).toContain("image?: { src?: string; alt?: string };");
      expect(checkBespokeSyntax(`"use client";\n${typeBlock}\nexport default function X(props: TestNestedProps) { return null; }`)).toBeNull();
    });

    it("survives sanitizeBespokeSource without corrupting fields after a nested object field", () => {
      const typeName = "TestNestedProps";
      const typeBlock = inferPropsType(
        {
          headline: "Headline",
          cta: { label: "Book", href: "/contact" },
          subcopy: "Should survive after the nested cta field",
        },
        typeName
      );

      // Simulate the LLM writing its own (differently-shaped) type block that sanitize must replace.
      const raw = `"use client";
import { Reveal } from "@/components/primitives";

type ${typeName} = {
  id?: string;
  headline?: string;
};

export default function CustomX(props: ${typeName}) {
  return <Reveal>{props.headline}</Reveal>;
}`;

      const fixed = sanitizeBespokeSource(raw, typeName, typeBlock);
      expect(fixed).toContain("subcopy?: string;");
      expect(validateBespokeSource(fixed, typeName)).toBeNull();
      expect(checkBespokeSyntax(fixed)).toBeNull();
    });
  });
});
