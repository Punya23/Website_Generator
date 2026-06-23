import { describe, it, expect, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    getCompositionModel: () => "test",
    getSectionModel: () => "test",
    chat: vi.fn(async (_system: string, user: string) => {
      if (user.includes("BLOCK IDS")) {
        return JSON.stringify({
          layout: {
            type: "Section",
            fullBleed: true,
            children: [
              {
                type: "Bento",
                columns: 1,
                children: ["home_hero_headline"],
              },
            ],
          },
        });
      }
      return JSON.stringify({
        blocks: [
          { id: "home_hero_headline", type: "headline", text: "Welcome", subtext: "Hello" },
        ],
      });
    }),
  },
}));

vi.mock("../src/media/enrich-content.js", () => ({
  enrichSectionImages: vi.fn(async (blocks: unknown[]) => blocks),
}));

import { buildPageSections } from "../src/agents/section-builder-agent.js";
import type { SiteContext } from "../src/types.js";
import { MediaRegistry } from "../src/media/media-registry.js";

function minimalCtx(): SiteContext {
  return {
    businessName: "Test Co",
    businessBrief: "test brief",
    expandedBrief: {
      businessName: "Test Co",
      tagline: "Tag",
      elevatorPitch: "Pitch",
      expandedBrief: "Long brief",
      targetAudience: "All",
      services: ["A", "B", "C"],
      differentiators: ["X", "Y", "Z"],
      tone: "warm",
      primaryCta: "Go",
    },
    sitePlan: {
      pages: [],
      compositionStrategy: "test",
      avoidPatterns: [],
    },
    designSystem: {
      vertical: "test",
      mood: "clean",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fff",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#000",
        accentSoft: "#eee",
        gradientFrom: "#000",
        gradientTo: "#333",
        navBg: "#fff",
      },
    },
    pages: {},
    mediaRegistry: [],
    cmsCollections: [],
    qaHistory: [],
  };
}

describe("section builder layout parsing", () => {
  it("sanitizes Groq Bento columns:1 layout without ZodError", async () => {
    const ctx = minimalCtx();
    const pagePlan = {
      slug: "home",
      title: "Home",
      goal: "Convert",
      minBlocks: 4,
      layoutHint: "Hero",
      contentFocus: ["value"],
      sections: [
        {
          id: "home_hero",
          intent: "Hero",
          blockTypes: ["headline"],
          archetype: "split_hero" as const,
        },
      ],
    };

    const sections = await buildPageSections(ctx, pagePlan, new MediaRegistry());
    expect(sections).toHaveLength(1);
    expect(sections[0]!.layout.type).toBe("Section");
  });
});
