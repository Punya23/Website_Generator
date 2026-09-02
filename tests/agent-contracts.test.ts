import { describe, it, expect } from "vitest";
import {
  validateAgentOutput,
  assertNoForbiddenFields,
  deepHasForbiddenKey,
  type AgentContract,
} from "../src/agents/contracts/agent-contract.js";
import { z } from "zod";

const TestSchema = z.object({ headline: z.string() });

const TEST_CONTRACT: AgentContract<{ headline: string }> = {
  name: "TestAgent",
  role: "test",
  outputSchema: TestSchema,
  forbiddenFields: ["colors", "imageQuery"],
};

describe("agent contracts", () => {
  it("validates allowed output", () => {
    const out = validateAgentOutput(TEST_CONTRACT, { headline: "Hello" });
    expect(out.headline).toBe("Hello");
  });

  // validateAgentOutput() itself strips forbidden fields silently (see agent-contract.test.ts) —
  // that's the lenient path production agents use. assertNoForbiddenFields/deepHasForbiddenKey
  // are the strict, throwing primitives for callers that want hard enforcement instead.
  it("assertNoForbiddenFields throws on forbidden top-level fields", () => {
    expect(() =>
      assertNoForbiddenFields({ headline: "Hi", colors: "#fff" }, TEST_CONTRACT.forbiddenFields, TEST_CONTRACT.name)
    ).toThrow(/forbidden field: colors/);
  });

  it("assertNoForbiddenFields passes when no forbidden fields are present", () => {
    expect(() =>
      assertNoForbiddenFields({ headline: "Hi" }, TEST_CONTRACT.forbiddenFields, TEST_CONTRACT.name)
    ).not.toThrow();
  });

  it("deepHasForbiddenKey finds nested forbidden fields", () => {
    expect(
      deepHasForbiddenKey({ headline: "Hi", meta: { imageQuery: "x" } }, TEST_CONTRACT.forbiddenFields)
    ).toBe("imageQuery");
  });

  it("deepHasForbiddenKey returns null when nothing forbidden is present", () => {
    expect(deepHasForbiddenKey({ headline: "Hi", meta: { note: "x" } }, TEST_CONTRACT.forbiddenFields)).toBeNull();
  });
});
