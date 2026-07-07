import { describe, it, expect } from "vitest";
import { normalizePageCodegenProps } from "../src/agents/page-codegen-normalize.js";

describe("page codegen normalize", () => {
  it("maps stats number field to value", () => {
    const props = normalizePageCodegenProps("stats_marquee", {
      stats: [
        { number: "12+", label: "Years" },
        { number: "200", label: "Projects" },
      ],
    });
    expect(props.stats).toEqual([
      { value: "12+", label: "Years" },
      { value: "200", label: "Projects" },
    ]);
  });

  it("flattens contactInfo and string formFields for ContactSplit", () => {
    const props = normalizePageCodegenProps("contact_split", {
      headline: "Ready?",
      formFields: ["Project Type", "Email", "Phone"],
      contactInfo: {
        phone: "(555) 123-4567",
        email: "hello@linea.com",
        address: "123 Main St",
        hours: "9-5",
      },
    });
    expect(props.contactInfo).toBeUndefined();
    expect(props.email).toBe("hello@linea.com");
    expect(props.formFields).toEqual([
      { label: "Project Type", type: "text", required: true },
      { label: "Email", type: "email", required: true },
      { label: "Phone", type: "tel", required: true },
    ]);
  });

  it("maps projects to slides for PortfolioCarousel", () => {
    const props = normalizePageCodegenProps("portfolio_carousel", {
      projects: [
        { name: "River House", category: "Residential" },
        { title: "Studio Annex", subtitle: "Commercial" },
      ],
    });
    expect(props.slides).toEqual([
      { title: "River House", category: "Residential", image: undefined },
      { title: "Studio Annex", category: "Commercial", image: undefined },
    ]);
  });

  it("maps services array to paragraphs for ServicesShowcase", () => {
    const props = normalizePageCodegenProps("services_showcase", {
      headline: "Our work",
      services: [
        { title: "Design", description: "Full service design." },
        { title: "Build", description: "Certified construction." },
      ],
    });
    expect(props.services).toBeUndefined();
    expect(props.paragraphs).toEqual([
      "Design — Full service design.",
      "Build — Certified construction.",
    ]);
  });
});
