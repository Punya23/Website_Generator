import { describe, it, expect } from "vitest";
import { validateAgentOutput, type AgentContract } from "../src/agents/contracts/agent-contract.js";
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

  it("rejects forbidden top-level fields", () => {
    expect(() =>
      validateAgentOutput(TEST_CONTRACT, { headline: "Hi", colors: "#fff" })
    ).toThrow(/forbidden field: colors/);
  });

  it("rejects nested forbidden fields", () => {
    expect(() =>
      validateAgentOutput(TEST_CONTRACT, { headline: "Hi", meta: { imageQuery: "x" } })
    ).toThrow(/forbidden field: imageQuery/);
  });
});
