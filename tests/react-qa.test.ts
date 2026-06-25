import { describe, it, expect } from "vitest";
import { runReactQA } from "../src/qa/react-qa.js";
import type { ReactPage } from "../src/types.js";

describe("react QA", () => {
  const goodPage: ReactPage = {
    slug: "home",
    title: "Home",
    sections: [
      {
        id: "home_hero",
        templateId: "hero_editorial",
        intent: "Hero",
        props: { headline: "Welcome", image: { src: "https://example.com/a.jpg" } },
      },
      {
        id: "home_intro",
        templateId: "intro_statement",
        intent: "Intro",
        props: { headline: "About", body: "Story" },
      },
      {
        id: "home_cta",
        templateId: "cta_band",
        intent: "CTA",
        props: { headline: "Go", cta: { label: "Start" } },
      },
    ],
  };

  it("passes a well-structured react page", () => {
    const qa = runReactQA(goodPage, "home");
    expect(qa.passed).toBe(true);
    expect(qa.issues.filter((i) => i.severity === "hard")).toHaveLength(0);
  });

  it("fails on unknown template", () => {
    const qa = runReactQA(
      {
        ...goodPage,
        sections: [
          {
            id: "bad",
            templateId: "unknown_thing",
            intent: "x",
            props: {},
          },
        ],
      },
      "home"
    );
    expect(qa.passed).toBe(false);
    expect(qa.issues.some((i) => i.code === "UNKNOWN_TEMPLATE")).toBe(true);
  });
});
