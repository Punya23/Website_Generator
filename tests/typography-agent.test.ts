import { describe, it, expect } from "vitest";
import { normalizeTypographyPartial } from "../src/agents/typography-agent.js";
import { TypographyPartialSchema } from "../src/types.js";

describe("normalizeTypographyPartial", () => {
  it("coerces object-shaped font fields to strings", () => {
    const raw = {
      fontHeading: "Playfair Display",
      fontBody: "Inter",
      typography: {
        display: { family: "Playfair Display", weight: 700 },
        heading: { font: "Playfair Display" },
        body: { name: "Inter" },
        label: { value: "Inter" },
        mono: "IBM Plex Mono",
      },
    };

    const normalized = normalizeTypographyPartial(raw);
    const parsed = TypographyPartialSchema.parse(normalized);

    expect(parsed.typography?.display).toBe("Playfair Display");
    expect(parsed.typography?.heading).toBe("Playfair Display");
    expect(parsed.typography?.body).toBe("Inter");
    expect(parsed.typography?.label).toBe("Inter");
    expect(parsed.typography?.mono).toBe("IBM Plex Mono");
  });

  it("drops typography keys that cannot be coerced", () => {
    const raw = {
      fontHeading: "Inter",
      fontBody: "Inter",
      typography: {
        display: { weight: 700 },
        body: "Inter",
      },
    };

    const normalized = normalizeTypographyPartial(raw);
    const parsed = TypographyPartialSchema.parse(normalized);

    expect(parsed.typography?.display).toBeUndefined();
    expect(parsed.typography?.body).toBe("Inter");
  });
});
