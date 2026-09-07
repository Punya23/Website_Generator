/**
 * Tool-loop repair pass for the exact sections `code-qa.ts`'s `validateSectionsStructurally`
 * flagged (EMPTY_SECTION, UNDEFINED_LEAK, RAW_JSON_LEAK, TEMPLATE_FILLER_LEAK) — the targeted
 * follow-up to `copy-polish-agent.ts`'s compulsory pass, only invoked when QA actually found
 * something broken, only on the runs QA pointed at.
 *
 * Uses `runToolLoop` (`llm/tool-loop.ts`) rather than one fire-and-parse call: the agent must call
 * `check_text` on its own proposed replacement — and see the result — before it's allowed to
 * `submit_fixes`. A bad replacement (still JSON-shaped, still empty, still lorem) gets caught and
 * revised in the same run instead of shipping a second bad answer to replace the first.
 */
import * as cheerio from "cheerio";
import { looksLikeLorem } from "../templates/filler-patterns.js";
import { looksLikeRawJson } from "../llm/parse-json.js";
import { llm } from "../llm/client.js";
import { allowMocks, strictLlmRequired } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { runToolLoop, type ToolDef } from "../llm/tool-loop.js";
import type { ExpandedBrief } from "../types.js";
import type { QAIssue } from "../types.js";

/** Codes a repair pass can plausibly fix by rewriting text — structural issues (overflow,
 *  cross-template mismatch) aren't in scope here, only content-shaped ones. `SLOT_SKIPPED` isn't a
 *  QA pattern match at all — `compose.ts` knows directly, with no guessing, exactly which sections
 *  had a copy slot the brief had nothing to say for (still the template author's own generic
 *  prose), and `verbatim-template-pipeline.ts` feeds those in as issues the same shape as QA's. */
const REPAIRABLE_CODES = new Set([
  "EMPTY_SECTION",
  "UNDEFINED_LEAK",
  "RAW_JSON_LEAK",
  "TEMPLATE_FILLER_LEAK",
  "SLOT_SKIPPED",
]);

const REPAIR_SYSTEM = `You are fixing broken copy on a real, specific business's website. QA flagged one or more
text runs as broken: empty, a raw JSON leak, leftover placeholder text, a literal "undefined", or —
most common — a copy slot the business's own brief had nothing to say for, so the template author's
own generic prose is still sitting there unchanged.

For each flagged run: write a short, real, specific replacement grounded in the business summary —
never generic template boilerplate, never JSON, never empty. Before you finish, call check_text on
EVERY replacement you propose. If check_text reports a problem, revise that replacement and call
check_text again. Only call finish once every replacement has passed check_text.

finish payload: {"finish": true, "fixes": [{"id": "<run id>", "text": "<replacement>"}]} — include
only runs you actually fixed.`;

interface FlaggedRun {
  id: string;
  sectionId: string;
  issueCode: string;
  currentText: string;
}

/** Every `data-wg-edit` run inside the sections QA flagged — the same anchors
 *  `copy-polish-agent.ts`'s `collectEditableRuns` reads, scoped down to just the broken sections
 *  instead of the whole page, so this pass never touches copy QA had nothing to say about. */
function collectFlaggedRuns(html: string, issues: QAIssue[]): FlaggedRun[] {
  const flaggedSectionIds = new Map<string, string>(); // sectionId -> issueCode (first one wins)
  for (const issue of issues) {
    if (issue.sectionId && REPAIRABLE_CODES.has(issue.code) && !flaggedSectionIds.has(issue.sectionId)) {
      flaggedSectionIds.set(issue.sectionId, issue.code);
    }
  }
  if (flaggedSectionIds.size === 0) return [];

  const $ = cheerio.load(html, null, false);
  const runs: FlaggedRun[] = [];
  for (const [sectionId, issueCode] of flaggedSectionIds) {
    $(`[data-section="${sectionId}"] [data-wg-edit]`).each((_, node) => {
      const el = $(node);
      const id = el.attr("data-wg-edit");
      const text = el.text().replace(/\s+/g, " ").trim();
      if (!id) return;
      runs.push({ id, sectionId, issueCode, currentText: text });
    });
  }
  return runs;
}

function checkTextTool(): ToolDef<{ text?: unknown }, { ok: boolean; reason?: string }> {
  return {
    name: "check_text",
    description: "Verifies one proposed replacement isn't itself broken. Args: {\"text\": \"<candidate>\"}",
    run: (args) => {
      const text = typeof args?.text === "string" ? args.text.trim() : "";
      if (!text) return { ok: false, reason: "empty" };
      if (looksLikeRawJson(text)) return { ok: false, reason: "still looks like raw JSON, not prose" };
      if (looksLikeLorem(text)) return { ok: false, reason: "still reads like placeholder/lorem text" };
      return { ok: true };
    },
  };
}

export interface SectionRepairResult {
  /** `data-wg-edit` id → repaired text, ready for `ComposeOptions.overrides` on a recompose. */
  overrides: Record<string, string>;
  attempted: number;
}

/**
 * Never throws outside `PIPELINE_QUALITY=1` (strict mode) — a repair failure leaves the flagged
 * sections exactly as broken as QA found them rather than blocking the whole generation, same
 * degrade contract as every other LLM step in this codebase.
 */
export async function repairFlaggedSections(
  brief: ExpandedBrief,
  pageSlug: string,
  html: string,
  issues: QAIssue[]
): Promise<SectionRepairResult> {
  const runs = collectFlaggedRuns(html, issues);
  if (runs.length === 0) return { overrides: {}, attempted: 0 };

  if (!llm.isAvailable) {
    if (!allowMocks()) return { overrides: {}, attempted: 0 };
    return { overrides: {}, attempted: 0 };
  }

  const userPrompt = `Business: ${brief.businessName}
Tagline: ${brief.tagline}
What they do: ${brief.elevatorPitch}
Tone: ${brief.tone}

Flagged runs on page "${pageSlug}":
${JSON.stringify(runs.map((r) => ({ id: r.id, issue: r.issueCode, currentText: r.currentText.slice(0, 200) })))}`;

  try {
    const { final } = await runToolLoop<{ fixes?: unknown }>(
      `section repair ${pageSlug}`,
      REPAIR_SYSTEM,
      userPrompt,
      [checkTextTool()],
      { tokenRole: "section", model: llm.getSectionModel(), maxIterations: 3 }
    );

    const runsById = new Map(runs.map((r) => [r.id, r.currentText]));
    const list = Array.isArray(final.fixes) ? final.fixes : [];
    const overrides: Record<string, string> = {};
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as { id?: unknown }).id;
      const text = (entry as { text?: unknown }).text;
      if (typeof id !== "string" || typeof text !== "string") continue;
      if (!runsById.has(id)) continue; // not one of the runs actually offered
      const trimmed = text.trim();
      // Belt and braces on top of the agent's own check_text calls — an agent that ignored its own
      // tool result and finished anyway must not still get to ship a broken replacement.
      if (!trimmed || looksLikeRawJson(trimmed) || looksLikeLorem(trimmed)) continue;
      overrides[id] = trimmed;
    }
    return { overrides, attempted: runs.length };
  } catch (err) {
    recordFallback("section_repair", pageSlug);
    pipelineLog(
      `[pipeline] Section repair (${pageSlug}) failed: ${err instanceof Error ? err.message : String(err)} — flagged sections stay as QA found them`
    );
    if (strictLlmRequired()) throw err;
    return { overrides: {}, attempted: runs.length };
  }
}
