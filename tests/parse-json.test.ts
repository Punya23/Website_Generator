import { describe, it, expect } from "vitest";
import { healMismatchedBrackets, parseLlmJson, repairLlmJson } from "../src/llm/parse-json.js";

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

  it("heals an array closed with } instead of ] — the exact malformed response a real Ollama call produced", () => {
    // Confirmed live: gen-verify2.log (a real generation), the same call, 3 retries in a row, all
    // with this exact mistake — a stable per-model tic, not a one-off. Neither the old trailing-
    // comma repair nor correct substring extraction can fix a wrong bracket TYPE.
    const raw = '{"queries":["family law consultation Austin","compassionate attorney mediation","Austin skyline legal office"} }';
    expect(parseLlmJson<{ queries: string[] }>(raw).queries).toEqual([
      "family law consultation Austin",
      "compassionate attorney mediation",
      "Austin skyline legal office",
    ]);
  });

  it("heals a mismatched bracket without touching a } or ] that appears inside a string value", () => {
    const raw = '{"note":"use { or ] as a placeholder","items":["a","b"]}';
    expect(healMismatchedBrackets(raw)).toBe(raw); // already valid — nothing to heal
    expect(parseLlmJson<{ note: string; items: string[] }>(raw)).toEqual({
      note: "use { or ] as a placeholder",
      items: ["a", "b"],
    });
  });

  it("does not invent a closer for a genuinely truncated response", () => {
    const raw = '{"queries":["a","b"';
    expect(() => parseLlmJson(raw)).toThrow(/Invalid JSON from LLM/);
  });
});
