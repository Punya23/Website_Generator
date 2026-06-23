import { describe, it, expect } from "vitest";
import type { ContentBlock, LayoutNode, SiteTheme } from "../src/types.js";
import { PRESETS } from "../src/agents/theme-agent.js";
import {
  renderLayoutNode,
  buildContentMap,
  collectLayoutBlockIds,
  renderPage,
} from "../src/renderer/render.js";

const theme: SiteTheme = PRESETS.default;

function pageOpts(overrides: Partial<Parameters<typeof renderPage>[0]> = {}) {
  return {
    title: "Home",
    slug: "home",
    businessName: "Test",
    businessBrief: "Luxury hair salon",
    theme,
    navLinks: [{ slug: "home", label: "Home" }],
    content: [] as ContentBlock[],
    layout: { type: "Stack" as const, children: [] },
    ...overrides,
  };
}

function makeBlock(id: string, type: string, extra: Record<string, unknown> = {}): ContentBlock {
  return { id, type, ...extra };
}

describe("Stack/Row/Grid renderer", () => {
  const variableContent: ContentBlock[] = [
    makeBlock("hero", "headline", {
      text: "A".repeat(200),
      subtext: "B".repeat(300),
    }),
    makeBlock("s1", "stat", { value: "500+", label: "Clients" }),
    makeBlock("s2", "stat", { value: "99.9%", label: "Uptime with a very long label that should wrap gracefully" }),
    makeBlock("s3", "stat", { value: "24/7", label: "Support" }),
    makeBlock("t1", "testimonial", {
      quote: "C".repeat(400),
      author: "Jane Doe, CEO of a company with a very long name",
    }),
    makeBlock("t2", "testimonial", { quote: "Short quote.", author: "Bob" }),
    makeBlock("img", "image", { alt: "Hero image" }),
    makeBlock("cta", "cta", {
      headline: "Get started today with our premium offering",
      subtext: "D".repeat(150),
      buttonText: "Book Now",
    }),
  ];

  const layout: LayoutNode = {
    type: "Stack",
    children: [
      { type: "Row", children: ["hero", "img"] },
      { type: "Grid", children: ["s1", "s2", "s3"], minColumnWidth: 200 },
      { type: "Grid", children: ["t1", "t2"] },
      "cta",
    ],
  };

  it("renders all primitives without absolute positioning", () => {
    const html = renderLayoutNode(layout, buildContentMap(variableContent), 3);
    expect(html).toContain('data-layout="Stack"');
    expect(html).not.toMatch(/position:\s*absolute/);
  });

  it("uses flow-based CSS and premium theme", () => {
    const html = renderPage(pageOpts({ content: variableContent, layout }));
    expect(html).toContain("data-cols");
    expect(html).toContain("grid-template-columns");
    expect(html).toContain("--nav-text");
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("reveal");
  });

  it("includes reveal animations script", () => {
    const html = renderPage(pageOpts({ content: variableContent, layout }));
    expect(html).toContain("IntersectionObserver");
  });

  it("handles missing images with placeholder", () => {
    const html = renderLayoutNode(layout, buildContentMap(variableContent), 3);
    expect(html).toContain("placeholder");
  });

  it("includes all block ids from layout tree", () => {
    expect(collectLayoutBlockIds(layout)).toEqual([
      "hero", "img", "s1", "s2", "s3", "t1", "t2", "cta",
    ]);
  });

  it("renders hero with background image", () => {
    const html = renderPage(
      pageOpts({
        content: [
          makeBlock("h", "headline", {
            text: "Welcome",
            subtext: "Luxury salon",
            heroImage: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1200",
          }),
        ],
        layout: { type: "Stack", children: ["h"] },
      })
    );
    expect(html).toContain("block-hero");
    expect(html).toContain("images.unsplash.com");
  });

  it("handles 5 items in grid", () => {
    const fiveStats = Array.from({ length: 5 }, (_, i) =>
      makeBlock(`stat${i}`, "stat", { value: `${i}`, label: `Label ${i}` })
    );
    const gridLayout: LayoutNode = { type: "Grid", children: fiveStats.map((s) => s.id) };
    const html = renderPage(pageOpts({ content: fiveStats, layout: gridLayout }));
    expect(html.match(/data-block-type="stat"/g)?.length).toBe(5);
  });
});
