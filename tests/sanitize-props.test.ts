import { describe, it, expect } from "vitest";
import { sanitizePropsForCodegen } from "../src/react-codegen/sanitize-props.js";
import { polishSectionProps } from "../src/agents/polish-section-props.js";

describe("sanitize props for codegen", () => {
  it("strips imageQuery from image fields", () => {
    const props = sanitizePropsForCodegen({
      headline: "Dstyle",
      image: {
        src: "https://example.com/a.jpg",
        imageQuery: "Dstyle hero",
        alt: "Dstyle",
      },
    });
    expect(props.image).toEqual({ src: "https://example.com/a.jpg", alt: "Dstyle" });
    expect(JSON.stringify(props)).not.toContain("imageQuery");
  });

  it("strips imageQuery from nested gallery items", () => {
    const props = sanitizePropsForCodegen({
      images: [{ src: "https://a.jpg", imageQuery: "gallery" }],
    });
    expect(props.images).toEqual([{ src: "https://a.jpg" }]);
  });
});

describe("polish section props", () => {
  const brief = {
    businessName: "Dstyle",
    tagline: "Elevate Your Ethnic Style",
    elevatorPitch: "Bespoke fashion in Mumbai.",
    expandedBrief: "A fashion boutique.",
    targetAudience: "Women",
    services: ["Bridal"],
    differentiators: ["Craft"],
    tone: "Elegant",
    primaryCta: "Book consultation",
    secondaryCta: "View collection",
  };

  it("replaces intent-echoing headlines on intro_statement", () => {
    const intent = "Highlight the brand's unique design philosophy";
    const props = polishSectionProps(
      "intro_statement",
      { label: intent, headline: intent, body: "Long body." },
      intent,
      brief
    );
    expect(props.headline).toBe("Elevate Your Ethnic Style");
    expect(props.label).toBeUndefined();
  });
});
