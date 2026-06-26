import { describe, it, expect } from "vitest";
import { validateCopyProps } from "../src/section-templates/schemas.js";
import { mergeCopyWithDefaults } from "../src/agents/section-props-shared.js";

describe("copy props validation", () => {
  it("accepts hero copy without image field", () => {
    const props = validateCopyProps("hero_editorial", {
      headline: "Elevating Tradition",
      subcopy: "Modern elegance for every occasion",
      cta: { label: "Book consultation", href: "/contact" },
    });
    expect(props.headline).toBe("Elevating Tradition");
    expect(props).not.toHaveProperty("image");
  });

  it("accepts text_marquee phrases without media", () => {
    const props = validateCopyProps("text_marquee", {
      phrases: ["Craft", "Quality", "Style"],
    });
    expect(props.phrases).toHaveLength(3);
  });

  it("mergeCopyWithDefaults fills missing phrases from defaults", () => {
    const defaults = {
      label: "In the details",
      phrases: ["Default one", "Default two", "Default three"],
      speed: "normal",
    };
    const merged = mergeCopyWithDefaults({ label: "Custom label" }, defaults);
    const props = validateCopyProps("text_marquee", merged);
    expect(props.label).toBe("Custom label");
    expect(props.phrases).toEqual(defaults.phrases);
  });
});
