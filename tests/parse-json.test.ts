import { describe, it, expect } from "vitest";
import { parseLlmJson, repairLlmJson } from "../src/llm/parse-json.js";

describe("parseLlmJson", () => {
  it("parses fenced JSON", () => {
    const raw = '```json\n{"pages":[{"slug":"home"}]}\n```';
    expect(parseLlmJson(raw)).toEqual({ pages: [{ slug: "home" }] });
  });

  it("repairs trailing commas", () => {
    const raw = '{"pages":[{"slug":"home","sections":[{"templateId":"hero_spotlight",},],},]}';
    const repaired = repairLlmJson(raw);
    expect(JSON.parse(repaired)).toEqual({
      pages: [{ slug: "home", sections: [{ templateId: "hero_spotlight" }] }],
    });
    expect(parseLlmJson(raw)).toEqual({
      pages: [{ slug: "home", sections: [{ templateId: "hero_spotlight" }] }],
    });
  });

  it("extracts JSON from leading prose", () => {
    const raw = 'Here is the blueprint:\n{"pages":[]}';
    expect(parseLlmJson(raw)).toEqual({ pages: [] });
  });

  it("repairs trailing commas in large nested planner payload", () => {
    const pages = Array.from({ length: 4 }, (_, i) => ({
      slug: ["home", "about", "services", "contact"][i],
      sections: [{ id: "s1", blockTypes: ["headline", "text"] }],
    }));
    const raw = JSON.stringify({ pages }).replace(
      '"blockTypes":["headline","text"]',
      '"blockTypes":["headline","text"],'
    );
    expect(parseLlmJson(raw)).toEqual({ pages });
  });
});
