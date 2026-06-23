import { describe, it, expect, vi } from "vitest";
import { applyFixes, applyContentPatches } from "../src/agents/fix-agent.js";
import type { ContentBlock, LayoutNode, QAIssue } from "../src/types.js";

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

  it("auto-fixes grid orphan by converting to stack", async () => {
    const issues: QAIssue[] = [
      {
        severity: "soft",
        code: "GRID_ORPHAN",
        message: "Single item in wide grid",
        targetId: "s1",
        suggestion: "Convert Grid to Stack",
      },
    ];

    const fix = await applyFixes(layout, content, issues, "Salon brief", "home");
    expect(fix.layout.type).toBe("Section");
  });

  it("patches long text content", async () => {
    const issues: QAIssue[] = [
      {
        severity: "soft",
        code: "TEXT_OVERFLOW",
        message: "Too long",
        targetId: "hero",
        suggestion: "Shorten headline",
      },
    ];

    const fix = await applyFixes(layout, content, issues, "Salon", "home");
    const patched = applyContentPatches(content, fix.contentPatches);
    const hero = patched.find((b) => b.id === "hero");
    expect(String(hero?.text).length).toBeLessThan(200);
  });

  it("widen grids on horizontal overflow", async () => {
    const gridLayout: LayoutNode = {
      type: "Grid",
      children: ["s1", "hero"],
      minColumnWidth: 200,
    };
    const issues: QAIssue[] = [
      {
        severity: "hard",
        code: "HORIZONTAL_OVERFLOW",
        message: "Overflow detected",
        suggestion: "Widen grid",
      },
    ];

    const fix = await applyFixes(gridLayout, content, issues, "Brief", "home");
    expect(fix.layout.minColumnWidth).toBeGreaterThan(200);
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
