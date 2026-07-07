import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichPropsImages } from "../src/agents/media-curator-agent.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "./helpers/mock-site.js";

vi.mock("../src/media/enrich-content.js", () => ({
  resolveUniqueImage: vi.fn(
    async (query: string, cacheKey: string) =>
      `https://picsum.photos/seed/${encodeURIComponent(cacheKey)}/800/600`
  ),
}));

function testCtx() {
  const brief = {
    businessName: "Moonrise Bakery",
    tagline: "Fresh bread",
    elevatorPitch: "Artisan bakery",
    expandedBrief: "Rustic sourdough bakery in Portland",
    targetAudience: "Locals",
    services: ["Bread", "Pastries"],
    differentiators: ["Sourdough"],
    tone: "Warm",
    primaryCta: "Order now",
  };
  const ctx = initSiteContext("Bakery", brief, mockPlan(brief), {
    vertical: "food",
    mood: "warm",
    fontHeading: "Inter",
    fontBody: "Inter",
    colors: {
      bg: "#faf7f2",
      surface: "#fff",
      text: "#111",
      muted: "#666",
      accent: "#c45c26",
      accentSoft: "#fff7ed",
      gradientFrom: "#c45c26",
      gradientTo: "#e85d04",
      navBg: "#fff",
    },
  });
  ctx.variationSeed = 42;
  return ctx;
}

describe("enrichPropsImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves nested item images for feature bento", async () => {
    const registry = new MediaRegistry();
    const props = {
      headline: "Our favorites",
      items: [
        { title: "Sourdough", description: "Daily bake", image: { alt: "Sourdough loaf" } },
        { title: "Croissant", description: "Buttery layers", image: { alt: "Croissant" } },
      ],
    };
    const out = await enrichPropsImages(
      "feature_bento",
      props,
      testCtx(),
      "home_s2_featurebento",
      "home",
      registry
    );
    const items = out.items as Array<{ image?: { src?: string } }>;
    expect(items[0]?.image?.src).toMatch(/^https:\/\//);
    expect(items[1]?.image?.src).toMatch(/^https:\/\//);
  });

  it("resolves flat gallery masonry images", async () => {
    const registry = new MediaRegistry();
    const props = {
      headline: "Inside our kitchen",
      images: [
        { alt: "Oven" },
        { alt: "Dough" },
        { alt: "Finished loaves" },
      ],
    };
    const out = await enrichPropsImages(
      "gallery_masonry",
      props,
      testCtx(),
      "home_s4_gallery",
      "home",
      registry
    );
    const images = out.images as Array<{ src?: string }>;
    expect(images).toHaveLength(3);
    for (const img of images) {
      expect(img.src).toMatch(/^https:\/\//);
    }
  });

  it("resolves horizontal gallery item images", async () => {
    const registry = new MediaRegistry();
    const props = {
      headline: "Workshops",
      items: [
        { title: "Beginner", subtitle: "Foundations", image: { alt: "Kneading dough" } },
        { title: "Advanced", subtitle: "Shaping", image: { alt: "Scoring loaf" } },
        { title: "Kids", subtitle: "Family class", image: { alt: "Kids baking" } },
      ],
    };
    const out = await enrichPropsImages(
      "horizontal_gallery",
      props,
      testCtx(),
      "workshops_s1_gallery",
      "workshops",
      registry
    );
    const items = out.items as Array<{ image?: { src?: string } }>;
    expect(items.every((item) => item.image?.src?.startsWith("https://"))).toBe(true);
  });
});
