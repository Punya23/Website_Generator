import { describe, it, expect } from "vitest";
import { renderContentBlock } from "../src/renderer/blocks.js";

describe("renderContentBlock", () => {
  it("renders list blocks as HTML ul", () => {
    const html = renderContentBlock({
      id: "svc_list",
      type: "list",
      title: "Our Services Include:",
      items: ["Cleanings", "Fillings"],
    });
    expect(html).toContain('data-block-type="list"');
    expect(html).toContain("<ul class=\"feature-list\">");
    expect(html).toContain("Cleanings");
    expect(html).not.toContain('{"id"');
  });

  it("renders form blocks with inputs and submit button", () => {
    const html = renderContentBlock({
      id: "contact_form",
      type: "form",
      title: "Schedule",
      fields: [
        { label: "Name", type: "text", required: true },
        { label: "Email", type: "email", required: true },
      ],
      submitLabel: "Submit",
    });
    expect(html).toContain("<form");
    expect(html).toContain('type="email"');
    expect(html).toContain("Submit");
    expect(html).not.toContain('{"id"');
  });

  it("does not render subsection headline as full hero", () => {
    const html = renderContentBlock({
      id: "home_services_1",
      type: "headline",
      text: "Our Services",
      level: 2,
      heroImage: "https://example.com/bg.jpg",
    });
    expect(html).toContain("section-headline");
    expect(html).not.toContain("block-hero");
  });

  it("renders hero headline with background when variant is hero", () => {
    const html = renderContentBlock({
      id: "home_hero_h",
      type: "headline",
      text: "Welcome",
      variant: "hero",
      heroImage: "https://example.com/hero.jpg",
    });
    expect(html).toContain("block-hero");
  });

  it("fallback does not JSON.stringify unknown blocks with text", () => {
    const html = renderContentBlock({
      id: "x_1",
      type: "mystery",
      title: "Hello",
      text: "World",
    });
    expect(html).toContain("Hello");
    expect(html).not.toContain('{"id"');
  });
});
