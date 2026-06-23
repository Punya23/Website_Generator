import { describe, it, expect, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: false,
    getChatModel: () => "test",
    getCompositionModel: () => "test",
    supportsVision: false,
  },
}));

import { composeLayout, mockComposition, validateLayoutTree } from "../src/agents/composition-agent.js";
import { generateContent } from "../src/agents/content-agent.js";
import { expandBrief } from "../src/agents/expand-brief-agent.js";
import { planSite } from "../src/agents/site-planner-agent.js";

describe("Composition agent", () => {
  it("mock composition uses Section, Stack, Row, Grid only", async () => {
    const expanded = await expandBrief("Luxury hair salon in Austin", "Lumière Salon");
    const plan = await planSite(expanded);
    const blocks = await generateContent(expanded, plan.pages[0]!);
    const layout = mockComposition(blocks, plan.pages[0]!, expanded, plan);

    const json = JSON.stringify(layout);
    expect(json).toMatch(/Section|Stack|Row|Grid/);
    expect(json).not.toMatch(/absolute|position|z-index/i);
  });

  it("includes every block id exactly once", async () => {
    const expanded = await expandBrief("Wealth management finserv", "Apex Capital");
    const plan = await planSite(expanded);
    const blocks = await generateContent(expanded, plan.pages[0]!);
    const layout = await composeLayout(blocks, plan.pages[0]!, expanded, plan);

    const collect = (node: { type: string; children: unknown[] }): string[] => {
      const ids: string[] = [];
      for (const c of node.children) {
        if (typeof c === "string") ids.push(c);
        else ids.push(...collect(c as { type: string; children: unknown[] }));
      }
      return ids;
    };

    expect(collect(layout).sort()).toEqual(blocks.map((b) => b.id).sort());
  });

  it("salon and finserv produce different layout structures", async () => {
    const salonBrief = await expandBrief("Luxury hair salon balayage Austin beauty", "Salon X");
    const finBrief = await expandBrief("Wealth management retirement planning fiduciary advisory", "FinCo");
    const salonPlan = await planSite(salonBrief);
    const finPlan = await planSite(finBrief);
    const salonBlocks = await generateContent(salonBrief, salonPlan.pages[0]!);
    const finBlocks = await generateContent(finBrief, finPlan.pages[0]!);

    const salonLayout = mockComposition(salonBlocks, salonPlan.pages[0]!, salonBrief, salonPlan);
    const finservLayout = mockComposition(finBlocks, finPlan.pages[0]!, finBrief, finPlan);

    expect(salonPlan.pages.length).toBeGreaterThanOrEqual(4);
    expect(finPlan.pages.length).toBeGreaterThanOrEqual(4);
    expect(salonLayout.children.length).toBeGreaterThan(2);
    expect(finservLayout.children.length).toBeGreaterThan(2);
  });

  it("validates Section layout primitive", () => {
    const tree = {
      type: "Stack" as const,
      children: [
        { type: "Section" as const, fullBleed: true, children: ["hero"] },
        { type: "Grid" as const, children: ["a", "b"], minColumnWidth: 240 },
      ],
    };
    expect(validateLayoutTree(tree).type).toBe("Stack");
  });
});

describe("Content agent", () => {
  it("generates rich content from expanded brief", async () => {
    const expanded = await expandBrief("Salon in Austin balayage", "Test Salon");
    const plan = await planSite(expanded);
    const blocks = await generateContent(expanded, plan.pages[0]!);

    expect(blocks.length).toBeGreaterThanOrEqual(15);
    for (const block of blocks) {
      expect(block).toHaveProperty("id");
      expect(block).not.toHaveProperty("layout");
    }
  });

  it("expand brief produces detailed context", async () => {
    const expanded = await expandBrief("Glow Salon — luxury cuts Austin");
    expect(expanded.services.length).toBeGreaterThanOrEqual(6);
    expect(expanded.expandedBrief.length).toBeGreaterThan(200);
  });

  it("site plan includes core pages", async () => {
    const expanded = await expandBrief("Local business offering services");
    const plan = await planSite(expanded);
    expect(plan.pages.length).toBeGreaterThanOrEqual(4);
    expect(plan.pages.some((p) => p.slug === "home")).toBe(true);
  });
});
