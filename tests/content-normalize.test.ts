import { describe, it, expect } from "vitest";
import {
  normalizeContentBlocks,
  normalizePlannerBlockTypes,
} from "../src/agents/content-normalize.js";

describe("normalizeContentBlocks", () => {
  it("coerces list type and preserves items", () => {
    const blocks = normalizeContentBlocks(
      [
        {
          id: "svc_list",
          type: "list",
          title: "Services Include:",
          items: ["Cleanings", "Fillings"],
        },
      ],
      "services_main"
    );
    expect(blocks[0]?.type).toBe("list");
    expect(blocks[0]?.items).toEqual(["Cleanings", "Fillings"]);
  });

  it("aliases text content field and cta headline", () => {
    const blocks = normalizeContentBlocks(
      [
        { id: "c_1", type: "text", content: "Hello world" },
        { id: "c_2", type: "cta", text: "Book now", buttonText: "Go" },
        { id: "c_3", type: "testimonial", text: "Great service", author: "Sam" },
      ],
      "contact_info"
    );
    expect(blocks[0]?.text).toBe("Hello world");
    expect(blocks[1]?.headline).toBe("Book now");
    expect(blocks[2]?.quote).toBe("Great service");
  });

  it("absorbs submit button into preceding form", () => {
    const blocks = normalizeContentBlocks(
      [
        {
          id: "c_form",
          type: "form",
          fields: [{ label: "Name", type: "text", required: true }],
        },
        { id: "c_btn", type: "button", text: "Send", buttonType: "submit" },
      ],
      "contact_schedule"
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("form");
    expect(blocks[0]?.submitLabel).toBe("Send");
  });

  it("strips heroImage from non-hero section headlines", () => {
    const blocks = normalizeContentBlocks(
      [
        {
          id: "home_services_1",
          type: "headline",
          text: "Our Services",
          level: 2,
          heroImage: "https://example.com/city.jpg",
        },
      ],
      "home_services"
    );
    expect(blocks[0]?.heroImage).toBeUndefined();
    expect(blocks[0]?.variant).toBeUndefined();
  });

  it("marks hero section headlines as hero variant", () => {
    const blocks = normalizeContentBlocks(
      [{ id: "home_hero_h", type: "headline", text: "Welcome" }],
      "home_hero"
    );
    expect(blocks[0]?.variant).toBe("hero");
  });

  it("coerces unknown types to text instead of leaving raw objects", () => {
    const blocks = normalizeContentBlocks(
      [{ id: "x_1", type: "accordion", title: "FAQ", items: ["A", "B"] }],
      "x_main"
    );
    expect(blocks[0]?.type).toBe("list");
  });
});

describe("normalizePlannerBlockTypes", () => {
  it("maps invented planner types to supported ones", () => {
    expect(normalizePlannerBlockTypes(["card", "button", "backgroundImage", "accordion"])).toEqual([
      "feature",
      "text",
      "image",
      "list",
    ]);
  });
});
