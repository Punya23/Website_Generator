import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  coerceEnumValue,
  coerceToNumber,
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

describe("coerceEnumValue", () => {
  const SPEEDS = ["slow", "normal", "fast"] as const;
  const UNITS = ["hours", "guests", "rooms", "sessions"] as const;

  it("passes through an exact match", () => {
    expect(coerceEnumValue("fast", SPEEDS)).toBe("fast");
  });

  it("is case-insensitive", () => {
    expect(coerceEnumValue("Fast", SPEEDS)).toBe("fast");
    expect(coerceEnumValue("SESSIONS", UNITS)).toBe("sessions");
  });

  it("tolerates singular/plural mismatches", () => {
    expect(coerceEnumValue("Session", UNITS)).toBe("sessions");
    expect(coerceEnumValue("guest", UNITS)).toBe("guests");
  });

  it("applies explicit synonyms the model commonly substitutes", () => {
    expect(coerceEnumValue("medium", SPEEDS, { medium: "normal" })).toBe("normal");
    expect(coerceEnumValue("Moderate", SPEEDS, { moderate: "normal" })).toBe("normal");
  });

  it("returns undefined instead of guessing when nothing matches", () => {
    expect(coerceEnumValue("blazing", SPEEDS)).toBeUndefined();
    expect(coerceEnumValue(undefined, SPEEDS)).toBeUndefined();
  });
});

describe("coerceToNumber", () => {
  it("passes through finite numbers", () => {
    expect(coerceToNumber(5)).toBe(5);
  });

  it("parses numeric strings", () => {
    expect(coerceToNumber("5")).toBe(5);
    expect(coerceToNumber(" 20 ")).toBe(20);
  });

  it("strips common currency/percent formatting", () => {
    expect(coerceToNumber("$1,200")).toBe(1200);
    expect(coerceToNumber("50%")).toBe(50);
  });

  it("returns undefined for non-numeric input", () => {
    expect(coerceToNumber("five")).toBeUndefined();
    expect(coerceToNumber(true)).toBeUndefined();
    expect(coerceToNumber(undefined)).toBeUndefined();
    expect(coerceToNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("media curator parseLlmJson", () => {
  it("module imports parseLlmJson without ReferenceError", async () => {
    const mod = await import("../src/agents/media-curator-agent.js");
    expect(mod.curateSectionMedia).toBeTypeOf("function");
  });
});
