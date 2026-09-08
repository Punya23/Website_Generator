/**
 * A cheap, explainable "is this template even worth using" signal — the corpus has no human
 * review step and nothing else ever screens a template's overall polish before it becomes
 * eligible for a customer's site. Deliberately not one opaque number: three named, independently
 * inspectable flags (surfaced in the admin corpus view) plus a 0-1 score used only for ranking
 * among templates that already pass the gate.
 *
 * Signals used are all things the ingest pipeline already computes for other reasons — no new
 * extraction, no LLM call, no thumbnail/screenshot:
 *   - `thinContent` / `lowConfidence` — from the same per-section `role`/`roleConfidence` values
 *     `select.ts` already ranks candidates with (see `scoreSection`). A template that is mostly
 *     unclassified ("other") sections, or whose few classified sections were themselves weak
 *     heuristic guesses, was never going to read as a real, ready-to-use business site.
 *   - `noAnimation` — direct textual evidence in the template's own final stylesheet
 *     (`@keyframes` blocks, and `animation`/`transition` declarations that carry a real non-zero
 *     duration rather than `none`/`0s`). Named because the user explicitly asked for this signal.
 */
export interface TemplateQualitySection {
  role: string;
  roleConfidence: number;
}

export interface TemplateQualityFlags {
  /** Too few classified (non-"other") sections, or "other" dominates the section list — thin or
   *  poorly-extracted content, not enough of a real page to build a site from. */
  thinContent: boolean;
  /** The sections that DID get a name were themselves weak heuristic/LLM guesses on average. */
  lowConfidence: boolean;
  /** No `@keyframes` and no `animation`/`transition` declaration with a real (non-zero) duration
   *  anywhere in the template's own stylesheet. */
  noAnimation: boolean;
}

export interface TemplateQuality {
  /** 0-1, informational — used only to rank among templates that already clear the gate, never
   *  to exclude on its own (see `MIN_FLAGS_TO_EXCLUDE` in select.ts). */
  score: number;
  flags: TemplateQualityFlags;
}

const MIN_NAMED_SECTIONS = 3;
const MIN_NAMED_ROLE_RATIO = 0.3;
const MIN_AVG_CONFIDENCE = 0.55;

const KEYFRAMES_RE = /@(-webkit-|-moz-|-o-)?keyframes\s+[\w-]+/gi;
// A duration of "0s"/"0ms" or a bare "none" is not real motion — only a declaration whose value
// carries an actual positive duration counts as animation evidence.
const MOTION_DECLARATION_RE = /\b(animation|transition)\s*:\s*[^;]*[1-9]\d*\s*m?s\b[^;]*;/gi;

export function computeTemplateQuality(sections: TemplateQualitySection[], css: string): TemplateQuality {
  const named = sections.filter((s) => s.role !== "other");
  const namedRatio = sections.length > 0 ? named.length / sections.length : 0;
  const avgConfidence =
    named.length > 0 ? named.reduce((sum, s) => sum + s.roleConfidence, 0) / named.length : 0;

  const hasAnimation = KEYFRAMES_RE.test(css) || MOTION_DECLARATION_RE.test(css);
  // RegExp.test with the `g` flag is stateful (advances lastIndex) — reset before any later reuse
  // of these module-level patterns against a different template's CSS.
  KEYFRAMES_RE.lastIndex = 0;
  MOTION_DECLARATION_RE.lastIndex = 0;

  const flags: TemplateQualityFlags = {
    thinContent: named.length < MIN_NAMED_SECTIONS || namedRatio < MIN_NAMED_ROLE_RATIO,
    lowConfidence: named.length > 0 && avgConfidence < MIN_AVG_CONFIDENCE,
    noAnimation: !hasAnimation,
  };

  const score = 0.4 * namedRatio + 0.35 * avgConfidence + 0.25 * (hasAnimation ? 1 : 0);

  return { score, flags };
}
