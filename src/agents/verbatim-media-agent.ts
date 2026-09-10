/**
 * Per-section photo-query curation for the verbatim template pipeline.
 *
 * `media-curator-agent.ts` already does this well for the react/skin-fill pipelines, but its
 * `TEMPLATE_IMAGE_FIELDS` map is keyed by typed-prop section-template ids (the skin/react section
 * catalog) — verbatim sections have no such props, only `PhotoSlot`s located by CSS selector at
 * ingest time. This reuses that agent's LLM-curation pattern (prompt shape, retry, strict/mock
 * fallback semantics) adapted to that shape instead of duplicating `TEMPLATE_IMAGE_FIELDS`.
 *
 * `src/templates/compose.ts` previously resolved every photo slot in a section from one bare
 * `${industry} ${role}` query — real, but generic enough that a "hero" query on a bakery site and
 * a "hero" query on a law-firm site differ only in the one industry word. This asks the LLM (when
 * available) for one grounded query per photo slot instead; the same generic query is still the
 * deterministic fallback whenever no provider is configured or a call fails outside strict mode.
 */
import { llm } from "../llm/client.js";
import { allowMocks, handleLlmFailure, requireLlm, strictLlmRequired } from "../util/llm-required.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { recordFallback } from "../util/fallback-tracker.js";
import type { ExpandedBrief } from "../types.js";
import type { PhotoSlot, SectionRole } from "./../templates/types.js";

const VERBATIM_MEDIA_PROMPT = `You are a stock-photo search assistant for one section of a real, specific business's website.

INPUT (read-only): the business, the section's role on the page, how many photos that section needs.
OUTPUT: JSON \`{"queries": ["<query>", ...]}\` — exactly one plain-English stock-photo search query per photo requested, in that order.

Rules:
- Ground every query in THIS business (its vertical, its services, its mood) — never a bare category word like "hero" or "team".
- 2-6 words, no punctuation, no quotes, no camera jargon.
- Different photos in the same section should read as different shots (e.g. a wide storefront vs. a close-up of the product), not the same query repeated.
- Output ONLY the queries array — nothing else.`;

function buildUserPrompt(brief: ExpandedBrief, role: SectionRole, count: number, industry: string): string {
  return `Business: ${brief.businessName}
Industry: ${industry}
Elevator pitch: ${brief.elevatorPitch}
Section role: ${role}
Photos needed: ${count}`;
}

function parseQueries(raw: string, count: number, fallbackQuery: string): string[] {
  const parsed = parseLlmJson<{ queries?: unknown }>(raw);
  const list = Array.isArray(parsed?.queries) ? parsed.queries : [];
  return Array.from({ length: count }, (_, i) => {
    const q = list[i];
    return typeof q === "string" && q.trim() ? q.trim().slice(0, 120) : fallbackQuery;
  });
}

/**
 * One curated (or, absent an LLM, deterministic-fallback) search query per photo slot, aligned to
 * `photoSlots` index order. Never throws outside `PIPELINE_QUALITY=1` (strict mode) — a curation
 * failure degrades to the same generic query `compose.ts` used before this agent existed.
 */
export async function curateVerbatimPhotoQueries(
  brief: ExpandedBrief,
  role: SectionRole,
  photoSlots: PhotoSlot[],
  industry: string
): Promise<string[]> {
  const fallbackQuery = `${industry} ${role}`.trim();
  const fallback = photoSlots.map(() => fallbackQuery);
  if (photoSlots.length === 0) return fallback;

  if (!llm.isAvailable) {
    if (!allowMocks()) requireLlm("verbatim media curation");
    return fallback;
  }

  try {
    return await chatJsonWithRetry(
      `verbatim media ${role}`,
      VERBATIM_MEDIA_PROMPT,
      (parseError) => {
        const suffix = parseError
          ? `\n\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Output valid JSON only.`
          : "";
        return buildUserPrompt(brief, role, photoSlots.length, industry) + suffix;
      },
      { tokenRole: "section", model: llm.getSectionModel(), initialTemperature: 0.5 },
      (raw) => parseQueries(raw, photoSlots.length, fallbackQuery)
    );
  } catch (err) {
    recordFallback("verbatim_media", role);
    pipelineLog(
      `[pipeline] Verbatim media curator (${role}) failed: ${err instanceof Error ? err.message : String(err)} — using generic query`
    );
    if (strictLlmRequired()) handleLlmFailure(`verbatim media curation (${role})`, err);
    return fallback;
  }
}
