import type { ContentBlock, LayoutNode, QAIssue, SiteContext } from "../types.js";
import { LayoutNodeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { normalizeLayoutNode, sanitizeLayoutNode } from "./layout-normalize.js";
import { serializeContextForFix } from "../site-context/assemble.js";
import { requireLlm } from "../util/llm-required.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { parseLlmJson } from "../llm/parse-json.js";

const FIX_SYSTEM = `You are a layout fix agent. QA found issues — apply minimal surgical fixes.

Output JSON: { "layout": { ... }, "contentPatches": [ { "id", "field", "value" } ] }

Primitives: Stack, Row, Grid, Section (fullBleed optional, columns optional).
Children are block id strings or nested nodes — never block objects.

Think about the issue — fix structure (Row→Stack, Grid columns, remove duplicate imagery), never truncate text.
Do NOT regenerate from scratch.`;

export interface FixResult {
  layout: LayoutNode;
  contentPatches: Array<{ id: string; field: string; value: string }>;
}

export interface ApplyFixesOptions {
  ctx: SiteContext;
  pageSlug: string;
  layout: LayoutNode;
  content: ContentBlock[];
  issues: QAIssue[];
}

export async function applyFixes(options: ApplyFixesOptions): Promise<FixResult> {
  const { layout, content, issues, ctx, pageSlug } = options;
  if (issues.length === 0) return { layout, contentPatches: [] };

  const autoFix = tryAutoFix(layout, content, issues);
  if (autoFix) {
    pipelineLog(`[fix] Auto-fixed ${pageSlug}: ${issues.map((i) => i.code).join(", ")}`);
    return autoFix;
  }

  requireLlm("layout fix");

  const blockIds = content.map((c) => c.id);
  // chatJsonWithRetry (up to 3 attempts) replaces a blind `JSON.parse(raw) as FixResult` — a
  // truncated or malformed fix response used to throw the whole QA-fix pass on the first bad
  // Ollama reply instead of getting a real re-ask.
  const parsed = await chatJsonWithRetry<FixResult>(
    `layout fix ${pageSlug}`,
    FIX_SYSTEM,
    (parseError) => {
      const suffix = parseError
        ? `\n\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Output valid JSON only.`
        : "";
      return `PAGE: ${pageSlug}
ISSUES:
${JSON.stringify(issues, null, 2)}

SITE CONTEXT:
${serializeContextForFix(ctx, pageSlug)}

CURRENT LAYOUT:
${JSON.stringify(layout, null, 2)}

BLOCK IDS: ${blockIds.join(", ")}${suffix}`;
    },
    { jsonMode: true, temperature: 0.2, model: llm.getFixModel(), tokenRole: "composition" },
    (raw) => {
      const candidate = parseLlmJson<Partial<FixResult>>(raw);
      if (!candidate.layout || typeof candidate.layout !== "object") {
        throw new SyntaxError('Expected a JSON object with a "layout" field');
      }
      return candidate as FixResult;
    }
  );
  const normalized = normalizeLayoutNode(parsed.layout, blockIds);
  if (!normalized) {
    throw new Error("Fix agent returned invalid layout");
  }

  return {
    layout: LayoutNodeSchema.parse(sanitizeLayoutNode(normalized)),
    contentPatches: parsed.contentPatches ?? [],
  };
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
    if (issue.code === "HORIZONTAL_OVERFLOW") {
      patchedLayout = rowToStackWhereNeeded(patchedLayout);
      changed = true;
    }
    if (issue.code === "BROKEN_IMAGE" && issue.targetId) {
      contentPatches.push({ id: issue.targetId, field: "src", value: "" });
      changed = true;
    }
    if (issue.code === "DUPLICATE_IMAGE" && issue.targetId) {
      contentPatches.push({ id: issue.targetId, field: "src", value: "" });
      contentPatches.push({ id: issue.targetId, field: "heroImage", value: "" });
      changed = true;
    }
    if (issue.code === "CARD_HEIGHT_MISMATCH" && issue.targetId) {
      patchedLayout = flattenRowWithImageAndText(patchedLayout, issue.targetId);
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
    children: node.children.map((c) => (typeof c === "string" ? c : flattenGridOrphans(c))),
  };
}

function rowToStackWhereNeeded(node: LayoutNode): LayoutNode {
  if (node.type === "Row") {
    return { type: "Stack", children: node.children };
  }
  return {
    ...node,
    children: node.children.map((c) => (typeof c === "string" ? c : rowToStackWhereNeeded(c))),
  };
}

function flattenRowWithImageAndText(node: LayoutNode, targetId: string): LayoutNode {
  if (node.type === "Row") {
    const hasTarget = node.children.some(
      (c) => c === targetId || (typeof c !== "string" && collectChildIds(c).includes(targetId))
    );
    if (hasTarget) return { type: "Stack", children: node.children };
  }
  return {
    ...node,
    children: node.children.map((c) =>
      typeof c === "string" ? c : flattenRowWithImageAndText(c, targetId)
    ),
  };
}

function collectChildIds(node: LayoutNode): string[] {
  const ids: string[] = [];
  for (const c of node.children) {
    if (typeof c === "string") ids.push(c);
    else ids.push(...collectChildIds(c));
  }
  return ids;
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
    if ((patch.field === "src" || patch.field === "heroImage") && !patch.value) {
      delete next.src;
      delete next.heroImage;
    }
    return next;
  });
}

export interface SectionFixResult {
  sections: Array<{
    sectionId: string;
    layout: LayoutNode;
    contentPatches: FixResult["contentPatches"];
  }>;
}

export async function applySectionScopedFixes(options: {
  ctx: SiteContext;
  pageSlug: string;
  sections: import("../types.js").PageSection[];
  issues: QAIssue[];
}): Promise<SectionFixResult | null> {
  const { sections, issues, ctx, pageSlug } = options;
  const sectionIds = new Set(
    issues.map((i) => i.sectionId).filter((id): id is string => Boolean(id))
  );
  if (sectionIds.size === 0) return null;

  const results: SectionFixResult["sections"] = [];

  for (const sectionId of sectionIds) {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) continue;

    const sectionIssues = issues.filter(
      (i) => i.sectionId === sectionId || section.blocks.some((b) => b.id === i.targetId)
    );
    if (sectionIssues.length === 0) continue;

    const fix = await applyFixes({
      ctx,
      pageSlug,
      layout: section.layout,
      content: section.blocks,
      issues: sectionIssues,
    });

    results.push({
      sectionId,
      layout: fix.layout,
      contentPatches: fix.contentPatches,
    });
  }

  return results.length > 0 ? { sections: results } : null;
}
