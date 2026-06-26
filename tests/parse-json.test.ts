import { describe, it, expect } from "vitest";
import { extractJsonPayload, normalizeLlmJsonContent, stripJsonFences } from "../src/llm/parse-json.js";

describe("normalizeLlmJsonContent", () => {
  it("strips ```json fences", () => {
    const raw = '```json\n{"pages":[]}\n```';
    expect(normalizeLlmJsonContent(raw)).toBe('{"pages":[]}');
    expect(JSON.parse(normalizeLlmJsonContent(raw))).toEqual({ pages: [] });
  });

  it("strips bare ``` fences", () => {
    const raw = '```\n{"ok":true}\n```';
    expect(JSON.parse(normalizeLlmJsonContent(raw))).toEqual({ ok: true });
  });

  it("extracts JSON when model adds preamble", () => {
    const raw = 'Here is the plan:\n{"pages":[{"slug":"home"}]}';
    expect(JSON.parse(normalizeLlmJsonContent(raw))).toEqual({
      pages: [{ slug: "home" }],
    });
  });

  it("passes through valid raw JSON", () => {
    const raw = '{"businessName":"Acme"}';
    expect(stripJsonFences(raw)).toBe(raw);
    expect(extractJsonPayload(raw)).toBe(raw);
  });
});
