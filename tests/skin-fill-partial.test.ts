import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    chat: vi.fn(),
    getPageCodegenModel: vi.fn(() => "test-model"),
  },
}));

import { llm } from "../src/llm/client.js";
import { fillSiteSkin } from "../src/agents/skin-fill-agent.js";
import { skinSectionId, type SiteSkin } from "../src/skins/schema.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { MediaRegistry } from "../src/media/media-registry.js";
import { resetFallbackTracker, totalFallbacks } from "../src/util/fallback-tracker.js";
import { mockPlan } from "./helpers/mock-site.js";

const SKIN: SiteSkin = {
  id: "test-skin",
  name: "Test Skin",
  categories: ["local-service"],
  visualFamily: "warm-consumer",
  description: "A minimal skin for exercising skin-fill partial acceptance.",
  chrome: { navShape: "full-width", footerLayout: "two-column" },
  motionPreset: "fade-up",
  widget: "none",
  pages: {
    home: [
      { templateId: "text_marquee", intent: "Marquee of core values" },
      { templateId: "quote_calculator", intent: "Estimate your project" },
    ],
    about: [{ templateId: "story_split", intent: "Our story" }],
    services: [{ templateId: "offer_index", intent: "What we offer" }],
    contact: [{ templateId: "contact_split", intent: "Get in touch" }],
  },
};

const IDS = {
  marquee: skinSectionId("home", 0, "text_marquee"),
  quote: skinSectionId("home", 1, "quote_calculator"),
  story: skinSectionId("about", 0, "story_split"),
  offer: skinSectionId("services", 0, "offer_index"),
  contact: skinSectionId("contact", 0, "contact_split"),
};

function brief() {
  return {
    businessName: "Northline Plumbing",
    tagline: "Family-owned plumbing",
    elevatorPitch: "Same-day plumbing and HVAC repairs.",
    expandedBrief: "Northline Plumbing is a family-owned contractor offering emergency repairs.",
    targetAudience: "Local homeowners",
    services: ["Repairs", "Installs", "Inspections"],
    differentiators: ["Same-day service", "Licensed techs"],
    tone: "Direct and reassuring",
    primaryCta: "Book a visit",
  };
}

function buildCtx() {
  const expanded = brief();
  return initSiteContext("Northline Plumbing", expanded, mockPlan(expanded), {
    vertical: "trades",
    mood: "practical",
    fontHeading: "Inter",
    fontBody: "Inter",
    colors: {
      bg: "#fafafa",
      surface: "#fff",
      text: "#111",
      muted: "#666",
      accent: "#c2410c",
      accentSoft: "#fff7ed",
      gradientFrom: "#c2410c",
      gradientTo: "#f97316",
      navBg: "#fff",
    },
  });
}

/** Every section gets valid copy except quote_calculator, whose pricePerUnit is a
 *  boolean — a malformed value repair intentionally does not paper over, so it stays
 *  invalid across every attempt no matter how the retry prompt is narrowed. */
function fullResponse() {
  return JSON.stringify({
    pages: {
      home: {
        [IDS.marquee]: { phrases: ["Fast", "Honest", "Local"], speed: "medium" },
        [IDS.quote]: {
          headline: "Estimate your project",
          packages: [{ name: "Basic", pricePerUnit: true }],
        },
      },
      about: {
        [IDS.story]: { headline: "Family-owned since 2005", paragraphs: ["We show up same day."] },
      },
      services: {
        [IDS.offer]: { items: [{ title: "Repairs", description: "Fast, licensed repairs." }] },
      },
      contact: {
        [IDS.contact]: { headline: "Get in touch" },
      },
    },
  });
}

describe("fillSiteSkin partial fallback", () => {
  beforeEach(() => {
    vi.mocked(llm.chat).mockReset();
    resetFallbackTracker();
  });

  it("keeps bespoke copy for every section that validates and mocks only the section that never does", async () => {
    vi.mocked(llm.chat).mockResolvedValue(fullResponse());

    const before = totalFallbacks();
    const { instances } = await fillSiteSkin(buildCtx(), SKIN, new MediaRegistry());

    const marquee = instances.home!.find((s) => s.id === IDS.marquee)!;
    const quote = instances.home!.find((s) => s.id === IDS.quote)!;
    const story = instances.about!.find((s) => s.id === IDS.story)!;

    expect(marquee.props.phrases).toEqual(["Fast", "Honest", "Local"]);
    expect(marquee.props.speed).toBe("normal");
    expect(story.props.headline).toBe("Family-owned since 2005");

    // The mock fallback derives package names from the brief's services list ("Repairs"),
    // not the LLM's attempted "Basic" — confirming this section used mock copy, not the LLM's.
    expect(Array.isArray(quote.props.packages)).toBe(true);
    const packages = quote.props.packages as Array<{ name: string; pricePerUnit: unknown }>;
    expect(packages[0]!.name).not.toBe("Basic");
    expect(packages[0]!.pricePerUnit).not.toBe(true);
    expect(typeof packages[0]!.pricePerUnit).toBe("number");

    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(totalFallbacks() - before).toBe(1);
  });

  it("narrows the retry prompt to only the still-failing sections", async () => {
    vi.mocked(llm.chat).mockResolvedValue(fullResponse());
    await fillSiteSkin(buildCtx(), SKIN, new MediaRegistry());

    const secondCallPrompt = vi.mocked(llm.chat).mock.calls[1]![1] as string;
    expect(secondCallPrompt).toContain(IDS.quote);
    expect(secondCallPrompt).not.toContain(IDS.marquee);
    expect(secondCallPrompt).not.toContain(IDS.story);
  });

  it("recovers on a later outer attempt after an earlier attempt's JSON is unparseable", async () => {
    // Simulates the real Ollama failure mode: reasoning overhead truncates JSON so badly that
    // chatJsonWithRetry exhausts its own 2 internal attempts and throws. That must not abort the
    // whole skin fill — the outer loop should still get its remaining attempts.
    vi.mocked(llm.chat)
      .mockResolvedValueOnce("{not valid json at all")
      .mockResolvedValueOnce("{still not valid json")
      .mockResolvedValue(fullResponse());

    const before = totalFallbacks();
    const { instances } = await fillSiteSkin(buildCtx(), SKIN, new MediaRegistry());
    const marquee = instances.home!.find((s) => s.id === IDS.marquee)!;

    expect(marquee.props.phrases).toEqual(["Fast", "Honest", "Local"]);
    // 2 calls burned failing to parse JSON on outer attempt 1, then outer attempts 2 and 3
    // each contribute one more call for the still-outstanding quote_calculator section.
    expect(llm.chat).toHaveBeenCalledTimes(4);
    expect(totalFallbacks() - before).toBe(1);
  });

  it("uses full bespoke copy with no fallback when every section validates", async () => {
    vi.mocked(llm.chat).mockResolvedValueOnce(
      JSON.stringify({
        pages: {
          home: {
            [IDS.marquee]: { phrases: ["Fast", "Honest", "Local"], speed: "fast" },
            [IDS.quote]: {
              headline: "Estimate your project",
              packages: [{ name: "Basic", pricePerUnit: 100 }],
            },
          },
          about: {
            [IDS.story]: { headline: "Family-owned since 2005", paragraphs: ["We show up same day."] },
          },
          services: {
            [IDS.offer]: { items: [{ title: "Repairs", description: "Fast, licensed repairs." }] },
          },
          contact: { [IDS.contact]: { headline: "Get in touch" } },
        },
      })
    );

    const before = totalFallbacks();
    const { instances } = await fillSiteSkin(buildCtx(), SKIN, new MediaRegistry());
    const quote = instances.home!.find((s) => s.id === IDS.quote)!;

    expect(quote.props.headline).toBe("Estimate your project");
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(totalFallbacks() - before).toBe(0);
  });
});
