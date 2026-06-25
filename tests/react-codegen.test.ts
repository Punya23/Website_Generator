import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { generateReactProject } from "../src/react-codegen/assemble-project.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

const OUT = path.resolve("output", "_test-react-codegen");

describe("react codegen", () => {
  beforeEach(async () => {
    await fs.rm(OUT, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(OUT, { recursive: true, force: true });
  });

  it("writes Next.js project files with section components", async () => {
    const brief = {
      businessName: "Dstyle",
      tagline: "Modern elegance",
      elevatorPitch: "Fashion brand",
      expandedBrief: "A fashion house.",
      targetAudience: "Women 25-45",
      services: ["Bridal", "Sarees", "Custom"],
      differentiators: ["Craft", "Quality", "Style"],
      tone: "Elegant",
      primaryCta: "Book consultation",
    };

    const sitePlan = mockPlan(brief);
    const ctx = initSiteContext("Fashion", brief, sitePlan, {
      vertical: "fashion",
      mood: "editorial luxe",
      fontHeading: "Playfair Display",
      fontBody: "Inter",
      sectionGapMode: "airy",
      colors: {
        bg: "#fafafa",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#e85d04",
        accentSoft: "#fff7ed",
        gradientFrom: "#e85d04",
        gradientTo: "#f48c06",
        navBg: "rgba(255,255,255,0.95)",
        navText: "#111",
        navMuted: "#666",
        navActiveBg: "#e85d04",
        navActiveText: "#fff",
      },
    });

    ctx.reactPages = {
      home: {
        slug: "home",
        title: "Home",
        sections: [
          {
            id: "home_hero",
            templateId: "hero_editorial",
            intent: "Hero",
            props: {
              headline: "Elevating Tradition",
              subcopy: "Modern elegance",
              image: { src: "https://images.pexels.com/photos/1.jpeg" },
            },
          },
          {
            id: "home_cta",
            templateId: "cta_band",
            intent: "CTA",
            props: {
              headline: "Book now",
              cta: { label: "Contact", href: "/contact" },
            },
          },
        ],
      },
    };

    const { projectPath } = await generateReactProject(ctx, ctx.reactPages, OUT);

    expect(await fs.stat(path.join(projectPath, "package.json"))).toBeTruthy();
    expect(await fs.stat(path.join(projectPath, "app", "page.tsx"))).toBeTruthy();
    expect(await fs.stat(path.join(projectPath, "components", "sections", "index.tsx"))).toBeTruthy();

    const homePage = await fs.readFile(path.join(projectPath, "app", "page.tsx"), "utf8");
    expect(homePage).toContain("HeroEditorial");
    expect(homePage).toContain("Elevating Tradition");
    expect(homePage).not.toContain("imageQuery");
    expect(homePage).not.toContain('{"id"');
  });

  it("writes page.tsx without imageQuery when props include enriched images", async () => {
    const brief = {
      businessName: "Dstyle",
      tagline: "Modern elegance",
      elevatorPitch: "Fashion brand",
      expandedBrief: "A fashion house.",
      targetAudience: "Women",
      services: ["Bridal"],
      differentiators: ["Craft"],
      tone: "Elegant",
      primaryCta: "Book consultation",
    };
    const sitePlan = mockPlan(brief);
    const ctx = initSiteContext("Fashion", brief, sitePlan, {
      vertical: "fashion",
      mood: "editorial",
      fontHeading: "Playfair Display",
      fontBody: "Inter",
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

    ctx.reactPages = {
      home: {
        slug: "home",
        title: "Home",
        sections: [
          {
            id: "home_hero",
            templateId: "hero_editorial",
            intent: "Hero",
            props: {
              headline: "Dstyle",
              image: {
                src: "https://images.pexels.com/photos/11795988/pexels-photo-11795988.jpeg",
                imageQuery: "should be stripped",
                alt: "Hero",
              },
            },
          },
        ],
      },
    };

    const { projectPath } = await generateReactProject(ctx, ctx.reactPages, OUT + "-build");
    const homePage = await fs.readFile(path.join(projectPath, "app", "page.tsx"), "utf8");
    expect(homePage).not.toContain("imageQuery");
  });

  it("builds Next.js project for localhost preview (no basePath)", async () => {
    const brief = {
      businessName: "Dstyle",
      tagline: "Modern elegance",
      elevatorPitch: "Fashion brand",
      expandedBrief: "A fashion house.",
      targetAudience: "Women",
      services: ["Bridal"],
      differentiators: ["Craft"],
      tone: "Elegant",
      primaryCta: "Book consultation",
    };
    const sitePlan = mockPlan(brief);
    const ctx = initSiteContext("Fashion", brief, sitePlan, {
      vertical: "fashion",
      mood: "editorial",
      fontHeading: "Playfair Display",
      fontBody: "Inter",
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

    ctx.reactPages = {
      home: {
        slug: "home",
        title: "Home",
        sections: [
          {
            id: "home_hero",
            templateId: "hero_editorial",
            intent: "Hero",
            props: {
              headline: "Dstyle",
              image: { src: "https://images.pexels.com/photos/11795988/pexels-photo-11795988.jpeg", alt: "Hero" },
            },
          },
        ],
      },
    };

    const { projectPath } = await generateReactProject(ctx, ctx.reactPages, OUT + "-preview");
    const { buildReactProject } = await import("../src/react-codegen/assemble-project.js");
    const outPath = await buildReactProject(projectPath);
    const index = await fs.readFile(path.join(outPath, "index.html"), "utf8");
    expect(index).toContain("/_next/");
    expect(index).toContain("Dstyle");
  }, 120_000);
});
