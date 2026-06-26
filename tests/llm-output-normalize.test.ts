import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  coerceToString,
  coerceToStringArray,
  normalizeCopyProps,
  normalizeExpandedBrief,
  normalizeAgentPayload,
  padArrayToMin,
  padCopyArraysFromDefaults,
} from "../src/llm/normalize-llm-output.js";
import { PalettePartialSchema } from "../src/types.js";
import { validateCopyProps } from "../src/section-templates/schemas.js";

describe("normalize LLM output", () => {
  it("joins mood array into string", () => {
    expect(coerceToString(["warm", "artisan", "cozy"])).toBe("warm artisan cozy");
    const parsed = PalettePartialSchema.parse(
      normalizeAgentPayload({
        mood: ["warm", "artisan", "cozy"],
        vertical: "bakery",
        colors: {
          bg: "#fff",
          surface: "#fff",
          text: "#111",
          muted: "#666",
          accent: "#c45",
          accentSoft: "#fee",
          gradientFrom: "#c45",
          gradientTo: "#e85",
        },
      })
    );
    expect(parsed.mood).toBe("warm artisan cozy");
  });

  it("joins body array for intro_statement", () => {
    const props = validateCopyProps("intro_statement", {
      headline: "Welcome",
      body: ["First paragraph.", "Second paragraph."],
    });
    expect(props.body).toBe("First paragraph. Second paragraph.");
  });

  it("joins body array for scroll_showcase", () => {
    const props = validateCopyProps("scroll_showcase", {
      headline: "Our process",
      body: ["Step one story.", "Step two story."],
    });
    expect(props.body).toBe("Step one story. Step two story.");
  });

  it("pads undersized team members from defaults", () => {
    const defaults = {
      headline: "Team",
      members: [
        { name: "Alex", role: "Lead", bio: "Bio A" },
        { name: "Sam", role: "Specialist", bio: "Bio B" },
      ],
    };
    const padded = padCopyArraysFromDefaults({ members: [{ name: "A", role: "R" }] }, defaults);
    expect(padded.members).toHaveLength(2);
  });

  it("normalizes expanded brief services string", () => {
    const out = normalizeExpandedBrief({
      businessName: "Test",
      tagline: "Tag",
      services: "bread, pastry, coffee",
      differentiators: ["a", "b", "c"],
    });
    expect(out.services).toEqual(["bread", "pastry", "coffee"]);
  });

  it("coerces string array fields", () => {
    expect(coerceToStringArray("one block")).toEqual(["one block"]);
  });

  it("pads array to minimum length", () => {
    expect(padArrayToMin(["a"], 3, (i) => `fill-${i}`)).toEqual(["a", "fill-1", "fill-2"]);
  });

  it("normalizeCopyProps coerces quote string fields", () => {
    const out = normalizeCopyProps("testimonial_featured", {
      quote: ["Great", "service"],
      author: "Jane",
    });
    expect(out.quote).toBe("Great service");
  });
});

describe("media curator parseLlmJson", () => {
  it("module imports parseLlmJson without ReferenceError", async () => {
    const mod = await import("../src/agents/media-curator-agent.js");
    expect(mod.curateSectionMedia).toBeTypeOf("function");
  });
});
