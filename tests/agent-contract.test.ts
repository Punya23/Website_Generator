import { describe, it, expect } from "vitest";
import {
  validateAgentOutput,
  unwrapAgentPayload,
  type AgentContract,
} from "../src/agents/contracts/agent-contract.js";
import { TypographyPartialSchema } from "../src/types.js";

const TYPOGRAPHY_CONTRACT: AgentContract<unknown> = {
  name: "TypographyAgent",
  role: "test",
  outputSchema: TypographyPartialSchema,
  forbiddenFields: ["colors", "navBg", "navTreatment", "pageTone", "gradientFrom", "motionPreset"],
};

describe("validateAgentOutput", () => {
  it("unwraps nested palette payload", () => {
    expect(unwrapAgentPayload({ palette: { vertical: "x", mood: "y" } })).toEqual({
      vertical: "x",
      mood: "y",
    });
  });

  it("strips top-level forbidden fields before validating typography", () => {
    const result = validateAgentOutput(TYPOGRAPHY_CONTRACT, {
      fontHeading: "Playfair Display",
      fontBody: "Inter",
      colors: { accent: "#000" },
      typography: { display: "Playfair Display", body: "Inter" },
      layout: { maxWidth: "1200px", gridColumns: "3", sectionGap: "4rem", cardMinHeight: "auto" },
    }) as { fontHeading: string; layout?: { gridColumns: number } };

    expect(result.fontHeading).toBe("Playfair Display");
    expect(result.layout?.gridColumns).toBe(3);
  });
});
