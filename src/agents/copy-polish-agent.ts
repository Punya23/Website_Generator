/**
 * Compulsory LLM copy-polish pass over an already-composed verbatim site.
 *
 * `templates/compose.ts` is, by design, 100% deterministic — no LLM ever touches the markup there
 * (see its module comment). That is also the literal gap behind "update the HTML compulsorily from
 * the LLM": there was no LLM copy step anywhere in the default pipeline for its output to be
 * dropped FROM. This adds one, as a second, narrowly-scoped pass over the composed HTML rather
 * than an LLM rewrite of raw markup (which risks corrupting selectors/structure): every text run
 * `anchorEditableText` (`copy-slots.ts`) already tagged with a stable `data-wg-edit` address is a
 * candidate; accepted edits are applied through the *same* `ComposeOptions.overrides` recompose
 * path the live click-to-edit save flow already exercises and is already tested — so "the LLM's
 * output" and "what actually ships" are structurally the same HTML, not two things that can drift
 * apart.
 */
import * as cheerio from "cheerio";
import { llm } from "../llm/client.js";
import { allowMocks, handleLlmFailure, requireLlm, strictLlmRequired } from "../util/llm-required.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { looksLikeRawJson, parseLlmJson } from "../llm/parse-json.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { recordFallback } from "../util/fallback-tracker.js";
import type { ExpandedBrief } from "../types.js";

const COPY_POLISH_PROMPT = `You are a copy editor polishing the text already on a real, specific business's website.

INPUT: a business summary and a numbered list of short text runs already on the page (each with a stable id).
OUTPUT: JSON \`{"edits": [{"id": "<id>", "text": "<polished text>"}]}\` — include ONLY runs you actually improved.

Rules:
- Sound like a real, specific business — never generic template boilerplate or corporate cliché ("We're passionate about...").
- Never invent facts, prices, awards, hours, or claims the business summary doesn't support.
- Keep each replacement roughly the same length as the original — a short label/heading must stay short.
- Fix awkward phrasing, leftover genericness, and repetition. Do not touch copy that already reads well and specifically.
- Skip (omit from the output) a structural label you shouldn't rewrite (e.g. "FAQ", "Contact", "Home") and anything already good.
- Output ONLY the edits array — nothing else.`;

interface EditableRun {
  id: string;
  text: string;
}

const MAX_RUNS_PER_PAGE = 60;
const MIN_RUN_LENGTH = 12;
const MAX_LENGTH_RATIO = 3;

function collectEditableRuns(html: string): EditableRun[] {
  const $ = cheerio.load(html, null, false);
  const runs: EditableRun[] = [];
  $("[data-wg-edit]").each((_, node) => {
    const id = $(node).attr("data-wg-edit");
    const text = $(node).text().replace(/\s+/g, " ").trim();
    if (id && text.length >= MIN_RUN_LENGTH) runs.push({ id, text });
  });
  return runs.slice(0, MAX_RUNS_PER_PAGE);
}

function buildUserPrompt(brief: ExpandedBrief, runs: EditableRun[]): string {
  return `Business: ${brief.businessName}
Tagline: ${brief.tagline}
What they do: ${brief.elevatorPitch}
Tone: ${brief.tone}

Text runs on this page:
${JSON.stringify(runs.map((r) => ({ id: r.id, text: r.text })))}`;
}

function parseEdits(raw: string, runsById: Map<string, string>): Record<string, string> {
  const parsed = parseLlmJson<{ edits?: unknown }>(raw);
  const list = Array.isArray(parsed?.edits) ? parsed.edits : [];
  const accepted: Record<string, string> = {};
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    const text = (entry as { text?: unknown }).text;
    if (typeof id !== "string" || typeof text !== "string") continue;
    const original = runsById.get(id);
    if (original === undefined) continue; // unknown id — not one of the runs this page actually offered
    const trimmed = text.trim();
    if (!trimmed) continue;
    // The live-site symptom this exists to catch: a model hands back the whole edits envelope (or
    // a stray nested object) as one entry's "text" — `entry.text` is a valid string, JSON.parse of
    // the outer response succeeded, and without this it splices verbatim `{"id":"...","text":...}`
    // straight into a heading. See `looksLikeRawJson`.
    if (looksLikeRawJson(trimmed)) continue;
    if (trimmed.length > original.length * MAX_LENGTH_RATIO) continue; // implausibly expanded, reject
    if (trimmed === original) continue; // not actually a change
    accepted[id] = trimmed;
  }
  return accepted;
}

export interface CopyPolishResult {
  /** `<templateId>:<sectionId>#<ordinal>` → polished text, ready to pass straight into
   *  `ComposeOptions.overrides` for a recompose. Empty when nothing was accepted OR the pass was
   *  skipped entirely (see `skipped`) — the caller doesn't need to distinguish the two to act
   *  correctly (skip the recompose either way), only to log correctly. */
  overrides: Record<string, string>;
  /** True when no provider was configured and mocks were allowed — the pass never ran, as opposed
   *  to running and accepting zero edits. */
  skipped: boolean;
}

/**
 * Polishes every page's already-composed copy. Never throws outside `PIPELINE_QUALITY=1` (strict
 * mode) — a failure on one page degrades that page to its unpolished (but already
 * filler-hardened, see `copy-slots.ts`) deterministic copy, exactly like every other LLM step in
 * this codebase (`src/util/llm-required.ts`).
 */
export async function polishComposedCopy(
  brief: ExpandedBrief,
  htmlPages: Record<string, string>
): Promise<CopyPolishResult> {
  if (!llm.isAvailable) {
    if (!allowMocks()) requireLlm("copy polish");
    return { overrides: {}, skipped: true };
  }

  const overrides: Record<string, string> = {};
  for (const [slug, html] of Object.entries(htmlPages)) {
    const runs = collectEditableRuns(html);
    if (runs.length === 0) continue;
    const runsById = new Map(runs.map((r) => [r.id, r.text]));

    try {
      const accepted = await chatJsonWithRetry(
        `copy polish ${slug}`,
        COPY_POLISH_PROMPT,
        (parseError) => {
          const suffix = parseError
            ? `\n\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Output valid JSON only.`
            : "";
          return buildUserPrompt(brief, runs) + suffix;
        },
        { tokenRole: "section", model: llm.getSectionModel(), initialTemperature: 0.5 },
        (raw) => parseEdits(raw, runsById)
      );
      Object.assign(overrides, accepted);
    } catch (err) {
      recordFallback("copy_polish", slug);
      pipelineLog(
        `[pipeline] Copy polish (${slug}) failed: ${err instanceof Error ? err.message : String(err)} — keeping deterministic copy for this page`
      );
      if (strictLlmRequired()) handleLlmFailure(`copy polish (${slug})`, err);
    }
  }

  return { overrides, skipped: false };
}
