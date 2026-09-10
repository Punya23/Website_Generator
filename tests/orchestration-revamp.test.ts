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

describe("react pipeline paths", () => {
  it("defaults to skin fill and keeps page-codegen behind a flag", () => {
    const src = readFileSync(join(root, "src/orchestrator/react-pipeline.ts"), "utf8");
    expect(src).toContain("useSkinFillPipeline");
    expect(src).toContain("fillSiteSkin");
    expect(src).not.toContain("directPageBlueprints");
    expect(src).not.toContain("fillSectionProps");
  });

  it("skin fill uses the skin as-is and does not overlay look-agent design language", () => {
    const src = readFileSync(join(root, "src/orchestrator/react-pipeline.ts"), "utf8");
    const start = src.indexOf("async function runSkinFillReactPipeline");
    const end = src.indexOf("async function runPageCodegenReactPipeline");
    const fn = src.slice(start, end);
    expect(fn).toContain("applySkinToContext");
    expect(fn).not.toContain("lookAndContract");
    expect(fn).not.toContain("applyPageRhythm");
    expect(fn).not.toContain("profileId:");
  });

  it("HTML output uses skins page-to-page instead of the legacy section-builder pipeline", () => {
    const orch = readFileSync(join(root, "src/orchestrator/orchestrator.ts"), "utf8");
    // Skin fill is now the fallback behind the verbatim-template path, not the outright default.
    expect(orch).toContain("const skinFill = !verbatim && useSkinFillPipeline()");
    expect(orch).not.toContain("outputMode === \"react\" && useSkinFillPipeline()");
    expect(orch).toContain("runSkinHtmlPipeline");
    const theme = readFileSync(join(root, "src/skins/theme.ts"), "utf8");
    expect(theme).not.toContain("vertical-profiles");
    expect(theme).not.toContain("GENERIC_THEME");
    expect(theme).not.toContain("mockPaletteForProfile");
  });

  it("does not rewrite template copy with an LLM unless PIPELINE_SKIN_FILL_LLM=1", () => {
    const src = readFileSync(join(root, "src/agents/skin-fill-agent.ts"), "utf8");
    expect(src).toContain("useSkinFillLlm");
    expect(src).toContain("mockFillSkinCopy");
    const fill = src.slice(src.indexOf("export async function fillSiteSkin"), src.indexOf("async function fillSkinCopyWithLlm"));
    expect(fill).toContain("useSkinFillLlm()");
    expect(fill).not.toContain("chatJsonWithRetry");
    const orch = readFileSync(join(root, "src/orchestrator/orchestrator.ts"), "utf8");
    expect(orch).toContain("expandBriefFromInput");
    expect(orch).toContain("Brief slotted from your input (no LLM rewrite)");
  });
});

describe("propsForCodegen hard-fails", () => {
  it("throws on invalid Zod props instead of soft-passing", () => {
    const src = readFileSync(join(root, "src/react-codegen/assemble-project.ts"), "utf8");
    expect(src).toContain("throw new Error");
    expect(src).toContain("Invalid props for template");
  });
});
