import { describe, it, expect, vi, beforeEach } from "vitest";

const lowMinBlocksPlan = {
  pages: [
    {
      slug: "home",
      title: "Home",
      goal: "Convert",
      minBlocks: 4,
      layoutHint: "Hero and features",
      contentFocus: ["value"],
    },
    {
      slug: "about",
      title: "About",
      goal: "Trust",
      minBlocks: 3,
      layoutHint: "Story",
      contentFocus: ["team"],
    },
    {
      slug: "services",
      title: "Services",
      goal: "Detail",
      minBlocks: 5,
      layoutHint: "Grid",
      contentFocus: ["offerings"],
    },
    {
      slug: "contact",
      title: "Contact",
      goal: "Reach",
      minBlocks: 2,
      layoutHint: "Form",
      contentFocus: ["contact"],
    },
  ],
  compositionStrategy: "test",
  avoidPatterns: [],
};

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    getCompositionModel: () => "test",
    chat: vi.fn(async () => JSON.stringify(lowMinBlocksPlan)),
  },
}));

vi.mock("../src/agents/expand-brief-agent.js", () => ({
  briefToContext: () => "brief context",
}));

import { planSite } from "../src/agents/site-planner-agent.js";
import type { ExpandedBrief } from "../src/types.js";

const brief: ExpandedBrief = {
  businessName: "Test Cafe",
  tagline: "Great coffee",
  elevatorPitch: "A neighborhood cafe.",
  expandedBrief: "We serve coffee and pastries.",
  targetAudience: "Locals",
  services: ["Coffee", "Pastries", "Catering"],
  differentiators: ["Fresh beans", "Warm space", "Fast service"],
  tone: "warm friendly",
  primaryCta: "Visit us",
};

describe("site planner normalization", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_MOCKS", "0");
  });

  it("accepts low minBlocks from Groq-style LLM output", async () => {
    const plan = await planSite(brief);

    expect(plan.pages).toHaveLength(4);
    for (const page of plan.pages) {
      expect(page.minBlocks).toBeGreaterThanOrEqual(1);
      expect(page.sections?.length).toBeGreaterThan(0);
    }
  });
});
