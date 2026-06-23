import type { ContentBlock, LayoutNode, QAIssue } from "../types.js";
import { LayoutNodeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { mockComposition } from "./composition-agent.js";
import { normalizeLayoutNode, repairLayoutCoverage } from "./layout-normalize.js";

const FIX_SYSTEM = `You are a layout fix agent. QA found visual/layout issues — apply MINIMAL targeted fixes.

Output valid JSON: { "layout": { ... }, "contentPatches": [ { "id": "...", "field": "...", "value": "..." } ] }

Primitives: Stack, Row, Grid, Section (with fullBleed boolean)
- children are block id STRINGS or nested nodes — never block objects

QA fix recipes:
- HORIZONTAL_OVERFLOW: widen Grid minColumnWidth (+40), or convert overflowing Row to Stack
- GRID_ORPHAN: single item in wide Grid → change Grid to Stack or merge into parent Stack
- TEXT_OVERFLOW: shorten via contentPatches (headline/text/quote fields, max 120 chars)
- BROKEN_IMAGE: contentPatches { field: "src", value: "" }

Do NOT regenerate layout from scratch. Preserve overall structure and archetype rhythm.`;

export interface FixResult {
  layout: LayoutNode;
  contentPatches: Array<{ id: string; field: string; value: string }>;
}

export async function applyFixes(
  layout: LayoutNode,
  content: ContentBlock[],
  issues: QAIssue[],
  businessBrief: string,
  pageKind: string
): Promise<FixResult> {
  if (issues.length === 0) {
    return { layout, contentPatches: [] };
  }

  const autoFix = tryAutoFix(layout, content, issues);
  if (autoFix) {
    console.log(
      `[fix] Auto-fixed ${pageKind}: ${issues.map((i) => i.code).join(", ")}`
    );
    return autoFix;
  }

  if (llm.isAvailable) {
    const hard = issues.filter((i) => i.severity === "hard");
    const raw = await llm.chat(
      FIX_SYSTEM,
      `PAGE: ${pageKind}
ISSUES:
${JSON.stringify(hard.length ? hard : issues, null, 2)}

CURRENT LAYOUT:
${JSON.stringify(layout, null, 2)}

BLOCK IDS: ${content.map((c) => c.id).join(", ")}
Business context: ${businessBrief.slice(0, 200)}`,
      { jsonMode: true, temperature: 0.2, model: llm.getCompositionModel(), maxTokens: 2048 }
    );
    const parsed = JSON.parse(raw) as FixResult;
    const blockIds = content.map((c) => c.id);
    const normalized =
      normalizeLayoutNode(parsed.layout, blockIds) ??
      repairLayoutCoverage(layout, blockIds);
    return {
      layout: LayoutNodeSchema.parse(normalized),
      contentPatches: parsed.contentPatches ?? [],
    };
  }

  return (
    tryAutoFix(layout, content, issues) ?? {
      layout: mockComposition(
        content,
        { slug: pageKind, title: pageKind, goal: "", minBlocks: 12, layoutHint: "", contentFocus: [] },
        {
          businessName: "",
          tagline: "",
          elevatorPitch: "",
          expandedBrief: businessBrief,
          targetAudience: "",
          services: [],
          differentiators: [],
          tone: "",
          primaryCta: "",
        },
        { pages: [], compositionStrategy: "", avoidPatterns: [] }
      ),
      contentPatches: [],
    }
  );
}

function tryAutoFix(
  layout: LayoutNode,
  content: ContentBlock[],
  issues: QAIssue[]
): FixResult | null {
  let patchedLayout = structuredClone(layout) as LayoutNode;
  const contentPatches: FixResult["contentPatches"] = [];
  let changed = false;

  for (const issue of issues) {
    if (issue.code === "GRID_ORPHAN" && issue.targetId) {
      patchedLayout = flattenGridOrphans(patchedLayout);
      changed = true;
    }
    if (issue.code === "TEXT_OVERFLOW" && issue.targetId) {
      const block = content.find((b) => b.id === issue.targetId);
      if (block) {
        const field = issue.suggestion?.includes("headline") ? "text" : "quote";
        const val = String(block[field] ?? block.text ?? "");
        if (val.length > 120) {
          contentPatches.push({ id: issue.targetId, field, value: val.slice(0, 117) + "..." });
          changed = true;
        }
      }
    }
    if (issue.code === "HORIZONTAL_OVERFLOW") {
      patchedLayout = widenGrids(patchedLayout);
      changed = true;
    }
    if (issue.code === "BROKEN_IMAGE" && issue.targetId) {
      contentPatches.push({ id: issue.targetId, field: "src", value: "" });
      changed = true;
    }
  }

  return changed ? { layout: patchedLayout, contentPatches } : null;
}

function flattenGridOrphans(node: LayoutNode): LayoutNode {
  if (node.type === "Grid" && node.children.length === 1) {
    const only = node.children[0]!;
    return typeof only === "string"
      ? { type: "Section", fullBleed: false, children: [only] }
      : flattenGridOrphans(only);
  }
  return {
    ...node,
    children: node.children.map((c) =>
      typeof c === "string" ? c : flattenGridOrphans(c)
    ),
  };
}

function widenGrids(node: LayoutNode): LayoutNode {
  if (node.type === "Grid") {
    return {
      ...node,
      minColumnWidth: Math.min((node.minColumnWidth ?? 240) + 40, 360),
      children: node.children.map((c) => (typeof c === "string" ? c : widenGrids(c))),
    };
  }
  return {
    ...node,
    children: node.children.map((c) => (typeof c === "string" ? c : widenGrids(c))),
  };
}

export function applyContentPatches(
  content: ContentBlock[],
  patches: FixResult["contentPatches"]
): ContentBlock[] {
  if (patches.length === 0) return content;
  return content.map((block) => {
    const patch = patches.find((p) => p.id === block.id);
    if (!patch) return block;
    const next = { ...block, [patch.field]: patch.value };
    if (patch.field === "src" && !patch.value) {
      delete next.src;
    }
    return next;
  });
}
