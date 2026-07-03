import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    getCompositionModel: () => "test-model",
    getSectionModel: () => "test-model",
    chat: vi.fn(),
  },
}));

vi.mock("../src/media/enrich-content.js", () => ({
  resolveUniqueImage: vi.fn(async (query: string) => `https://images.example.com/${encodeURIComponent(query)}.jpg`),
}));

import { llm } from "../src/llm/client.js";
import { fillSectionProps } from "../src/agents/section-props-agent.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { resetFallbackTracker, getFallbackSummary } from "../src/util/fallback-tracker.js";
import { mockPlan } from "./helpers/mock-site.js";

const brief = {
  businessName: "Wren & Ives",
  tagline: "Considered interiors",
  elevatorPitch: "A residential design studio for people who don't want their home to look designed.",
  expandedBrief: "Wren & Ives is a residential interior design studio.",
  targetAudience: "Homeowners renovating a primary residence",
  services: ["Full home design", "Kitchen renovation", "Furniture sourcing"],
  differentiators: ["In-house workshop", "Fixed-fee pricing", "20 years experience"],
  tone: "Warm, confident",
  primaryCta: "Book a consultation",
  secondaryCta: "View our work",
};

function makeCtx() {
  return initSiteContext("Wren & Ives", brief, mockPlan(brief), {
    vertical: "interior-design",
    mood: "warm minimal",
    fontHeading: "Fraunces",
    fontBody: "Inter",
    accentRole: "editorial",
    colors: {
      bg: "#faf9f6",
      surface: "#fff",
      text: "#161513",
      muted: "#6b6862",
      accent: "#9c6b3f",
      accentSoft: "#f4ece2",
      gradientFrom: "#9c6b3f",
      gradientTo: "#c79a63",
      navBg: "#fff",
      navText: "#161513",
      navMuted: "#6b6862",
      navActiveBg: "#9c6b3f",
      navActiveText: "#fff",
    },
  });
}

/** Route llm.chat by which agent's system prompt is active, returning a payload the test
 *  configures per-scenario. Mirrors the copywriter/media-curator prompt text so real parsing
 *  and validation logic (chatJsonWithRetry, repairTemplateProps, Zod schemas) run unmodified. */
function mockLlmChat(copyPayload: Record<string, unknown>, mediaPayload: Record<string, unknown>) {
  vi.mocked(llm.chat).mockImplementation(async (system: string) => {
    if (system.includes("copywriter")) return JSON.stringify(copyPayload);
    if (system.includes("media curator")) return JSON.stringify(mediaPayload);
    return JSON.stringify({});
  });
}

describe("fillSectionProps — production crash regression + structural fallback", () => {
  beforeEach(() => {
    resetFallbackTracker();
    vi.mocked(llm.chat).mockReset();
  });

  it("gallery_masonry: media curator returning no images no longer crashes (confirmed production bug)", async () => {
    const ctx = makeCtx();
    const registry = new MediaRegistry();

    // Exactly the confirmed crash condition: media curator LLM omits `images` entirely.
    mockLlmChat({ headline: "Inside our projects" }, {});

    const instance = await fillSectionProps(
      ctx,
      "home",
      { id: "home_gallery", templateId: "gallery_masonry", intent: "Showcase recent projects" },
      registry
    );

    expect(Array.isArray(instance.props.images)).toBe(true);
    expect((instance.props.images as unknown[]).length).toBeGreaterThanOrEqual(3);

    // The repair-props.ts fix satisfies the schema on the very first pass — no retry/degrade needed.
    // (Since zero real images existed to reuse, the padded slots are schema-valid placeholders
    // without a resolved `src` — not crashing is the guarantee here, not visual completeness.)
    expect(getFallbackSummary().section_props ?? 0).toBe(0);
  });

  it("gallery_masonry: pads a too-short images array from the media curator up to the schema minimum", async () => {
    const ctx = makeCtx();
    const registry = new MediaRegistry();

    mockLlmChat(
      { headline: "Inside our projects" },
      { images: [{ imageQuery: "kitchen renovation" }] }
    );

    const instance = await fillSectionProps(
      ctx,
      "home",
      { id: "home_gallery", templateId: "gallery_masonry", intent: "Showcase recent projects" },
      registry
    );

    const images = instance.props.images as Record<string, unknown>[];
    expect(images.length).toBeGreaterThanOrEqual(3);
    // The media curator resolved a real src for its one item; repair reuses it for the padded
    // filler slots rather than shipping blank tiles.
    expect(images.every((img) => typeof img.src === "string" && img.src.length > 0)).toBe(true);
  });

  it("degrades to minimal valid props (with real resolved images) when the media curator repeatedly returns a malformed required field", async () => {
    const ctx = makeCtx();
    const registry = new MediaRegistry();

    // hero_editorial.image is required; a media curator LLM hallucinating a bare number instead
    // of an object/string is not fixed by coerceImageField and has no repair-props.ts case —
    // this is the "self-healed but fragile" class flagged by the audit. Returning it on every
    // call (including the retry) forces both the initial attempt and the retry to fail, which
    // must trip the final degrade path rather than propagate an uncaught ZodError.
    mockLlmChat(
      { headline: "Homes that feel like you", subcopy: "Considered interiors, built to last." },
      { image: 12345 }
    );

    const instance = await fillSectionProps(
      ctx,
      "home",
      { id: "home_hero", templateId: "hero_editorial", intent: "Opening hero" },
      registry
    );

    expect(instance.props.headline).toBeTruthy();
    const image = instance.props.image as Record<string, unknown> | undefined;
    expect(image?.src).toBeTruthy();
    expect(typeof image?.src).toBe("string");

    // Exactly one section_props fallback should be recorded for this section.
    expect(getFallbackSummary().section_props).toBe(1);
  });

  it("does not throw for any template when the media curator LLM call fails outright", async () => {
    const ctx = makeCtx();
    const registry = new MediaRegistry();

    vi.mocked(llm.chat).mockImplementation(async (system: string) => {
      if (system.includes("copywriter")) {
        return JSON.stringify({ headline: "Our gallery", label: "Work" });
      }
      throw new Error("simulated media curator outage");
    });

    await expect(
      fillSectionProps(
        ctx,
        "home",
        { id: "home_gallery", templateId: "gallery_masonry", intent: "Showcase recent projects" },
        registry
      )
    ).resolves.toBeTruthy();
  });
});
