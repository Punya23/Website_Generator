import { describe, it, expect, vi } from "vitest";
import { applyFixes, applyContentPatches } from "../src/agents/fix-agent.js";
import type { ContentBlock, LayoutNode, QAIssue, SiteContext } from "../src/types.js";

function minimalCtx(pageSlug = "home"): SiteContext {
  return {
    businessName: "Test Co",
    businessBrief: "A test business",
    expandedBrief: {
      businessName: "Test Co",
      tagline: "Test tagline",
      elevatorPitch: "Pitch",
      expandedBrief: "Long brief text for testing.",
      targetAudience: "Everyone",
      services: ["Service A"],
      differentiators: ["Quality"],
      tone: "professional",
      primaryCta: "Start",
      secondaryCta: "Learn",
    },
    sitePlan: {
      pages: [{ slug: "home", title: "Home", navLabel: "Home", goal: "Convert", minBlocks: 5, layoutHint: "Hero then grid", contentFocus: ["value"] }],
      compositionStrategy: "test",
      avoidPatterns: [],
      visualArchetype: "test",
      motionStyle: "subtle",
    },
    designSystem: {
      vertical: "test",
      mood: "clean",
      fontHeading: "Inter",
      fontBody: "Inter",
      colors: {
        bg: "#fff",
        surface: "#fff",
        text: "#111",
        muted: "#666",
        accent: "#000",
        accentSoft: "#eee",
        gradientFrom: "#000",
        gradientTo: "#333",
        navBg: "#fff",
      },
    },
    pages: {
      [pageSlug]: {
        slug: pageSlug,
        title: "Home",
        navLabel: "Home",
        sections: [],
      },
    },
    mediaRegistry: [],
    qaHistory: [],
  };
}

describe("Fix agent + QA retry", () => {
  const content: ContentBlock[] = [
    { id: "hero", type: "headline", text: "A".repeat(200) },
    { id: "s1", type: "stat", value: "99%", label: "Uptime" },
  ];

  const layout: LayoutNode = {
    type: "Grid",
    children: ["s1"],
    minColumnWidth: 240,
  };

  it("auto-fixes grid orphan by converting to section", async () => {
    const issues: QAIssue[] = [
      {
        severity: "soft",
        code: "GRID_ORPHAN",
        message: "Single item in wide grid",
        targetId: "s1",
        suggestion: "Convert Grid to Stack",
      },
    ];

    const fix = await applyFixes({
      ctx: minimalCtx(),
      pageSlug: "home",
      layout,
      content,
      issues,
    });
    expect(fix.layout.type).toBe("Section");
  });

  it("converts row to stack on horizontal overflow", async () => {
    const rowLayout: LayoutNode = {
      type: "Row",
      children: ["s1", "hero"],
      columns: 2,
    };
    const issues: QAIssue[] = [
      {
        severity: "hard",
        code: "HORIZONTAL_OVERFLOW",
        message: "Overflow detected",
        suggestion: "Use Stack",
      },
    ];

    const fix = await applyFixes({
      ctx: minimalCtx(),
      pageSlug: "home",
      layout: rowLayout,
      content,
      issues,
    });
    expect(fix.layout.type).toBe("Stack");
  });

  it("clears duplicate image src via content patch", async () => {
    const issues: QAIssue[] = [
      {
        severity: "hard",
        code: "DUPLICATE_IMAGE",
        message: "Duplicate hero URL",
        targetId: "hero",
        suggestion: "Use different image",
      },
    ];

    const fix = await applyFixes({
      ctx: minimalCtx(),
      pageSlug: "home",
      layout,
      content: [{ id: "hero", type: "image", alt: "Hero", src: "https://example.com/a.jpg" }],
      issues,
    });
    const patched = applyContentPatches(
      [{ id: "hero", type: "image", alt: "Hero", src: "https://example.com/a.jpg" }],
      fix.contentPatches
    );
    expect(patched[0]?.src).toBeUndefined();
  });
});

describe("Vision polish scheduling", () => {
  it("runs in background without blocking", async () => {
    const { scheduleVisionPolish } = await import("../src/agents/vision-agent.js");
    const done = vi.fn();

    scheduleVisionPolish(
      async () => [{ slug: "home", base64: "abc" }],
      done
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(done).toHaveBeenCalled();
    const result = done.mock.calls[0]![0] as Record<string, { status: string }>;
    expect(result.home?.status).toBe("skipped");
  });
});
