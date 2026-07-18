import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

describe("motion reduced-motion semantics", () => {
  it("coerceMotionPlan preserves explicit false via === true checks", () => {
    const src = readFileSync(
      join(root, "src/react-codegen/component-library/components/MotionProvider.tsx"),
      "utf8"
    );
    expect(src).toMatch(/compactOnScroll:\s*nav\?\.compactOnScroll\s*===\s*true|compactOnScroll:\s*.*===\s*true/);
    expect(src).toContain('plan?.reducedMotion === "minimal"');
    expect(src).not.toMatch(/prefersReduced \|\| plan\?\.reducedMotion === "respect"/);
  });
});

describe("page-codegen has no salvage path", () => {
  it("does not drop requiredHero after failed retries", () => {
    const src = readFileSync(join(root, "src/agents/page-codegen-agent.ts"), "utf8");
    expect(src).not.toContain("requiredHero: undefined");
    expect(src).not.toMatch(/salvage/i);
  });
});

describe("legacy pipeline removed", () => {
  it("react-pipeline no longer branches on usePageCodegenPipeline", () => {
    const src = readFileSync(join(root, "src/orchestrator/react-pipeline.ts"), "utf8");
    expect(src).toContain("sole React path");
    expect(src).not.toContain("directPageBlueprints");
    expect(src).not.toContain("fillSectionProps");
  });
});

describe("propsForCodegen hard-fails", () => {
  it("throws on invalid Zod props instead of soft-passing", () => {
    const src = readFileSync(join(root, "src/react-codegen/assemble-project.ts"), "utf8");
    expect(src).toContain("throw new Error");
    expect(src).toContain("Invalid props for template");
  });
});
