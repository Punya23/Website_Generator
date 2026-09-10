import type { ExpandedBrief } from "../types.js";
import { ExpandedBriefSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { normalizeExpandedBrief } from "../llm/normalize-llm-output.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { extractBusinessName } from "../util/extract-name.js";

const EXPAND_SYSTEM = `You are a senior brand strategist. The user gives a 1-2 line business description.
Expand it into a rich creative brief for a full production website — ANY industry, ANY scale.

Output valid JSON only:
{
  "businessName": "extracted or inferred brand name",
  "tagline": "memorable 6-10 word tagline",
  "elevatorPitch": "2-3 sentence pitch",
  "expandedBrief": "3-4 paragraph detailed description: who they are, what they offer, why they're different, location/vibe if known",
  "targetAudience": "specific audience description",
  "services": ["6-10 specific services or offerings"],
  "differentiators": ["4-6 unique selling points"],
  "tone": "brand voice in 3-5 words",
  "primaryCta": "main call to action phrase",
  "secondaryCta": "optional secondary CTA"
}

Be specific to THIS business — never generic filler. Invent plausible details when missing but keep them consistent.`;

function firstSentence(text: string): string {
  const match = text.trim().match(/^[^.!?\n]{8,120}/);
  return (match?.[0] ?? text.trim().slice(0, 80)).replace(/[,:;]\s*$/, "").trim();
}

function padList(values: string[], fallback: string[], min: number): string[] {
  const unique = [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 1))];
  for (const extra of fallback) {
    if (unique.length >= min) break;
    if (!unique.includes(extra)) unique.push(extra);
  }
  while (unique.length < min) unique.push(fallback[unique.length % fallback.length]!);
  return unique.slice(0, Math.max(min, unique.length));
}

/** A genuine services list needs a real signal — a label ("services:"), a listing verb ("we
 *  offer X, Y and Z"), or a strong delimiter (bullet/semicolon/newline). Bare commas and "and"
 *  are far too common in ordinary prose to read as list separators on their own: splitting a
 *  plain one-sentence brief on them fragments the sentence into nonsense entries (confirmed
 *  live — "commercial construction and roof repair contractor in Denver, Colorado." split into
 *  "roof repair contractor in Denver" and "Colorado." and shipped as two "services"). Without one
 *  of these signals, this returns nothing rather than guess wrong — `padList` fills from the
 *  generic fallback, which is honest filler instead of a mangled sentence fragment. */
const LIST_CUE_RE =
  /\b(?:services?|offerings?|specializ\w*\s+in|offer(?:ing|s)?|provid\w*|featuring|including|such as)\b[:\-]?\s*(.+)$/i;

function servicesFromBrief(raw: string): string[] {
  const cued = raw.match(LIST_CUE_RE)?.[1];
  const source = cued ?? (/[;\n•]/.test(raw) ? raw : "");
  if (!source) return [];
  const listed = source
    .split(/[,;•\n]| and /i)
    .map((part) => part.replace(/^[-—\d.)\s]+/, "").replace(/[.!?]+$/, "").trim())
    .filter((part) => part.length > 2 && part.length < 48 && !/^(a|an|the|for|with|from)$/i.test(part));
  return listed.slice(0, 8);
}

const SERVICE_FALLBACKS = [
  "Consultations", "Core services", "Custom work", "Personalized solutions", "Expert support", "Flexible scheduling",
];
const DIFFERENTIATOR_FALLBACKS = [
  "Clear communication", "Reliable delivery", "Attention to detail",
  "Licensed and insured", "Locally owned and operated", "Fast response times",
];

/** Slot the user's own words into the expanded-brief shape — no LLM, no invented tagline. */
export function expandBriefFromInput(rawBrief: string, businessName?: string): ExpandedBrief {
  const name = (businessName ?? extractBusinessName(rawBrief)).trim() || "Your Business";
  const text = rawBrief.trim() || name;
  const tagline = firstSentence(text);
  const services = padList(servicesFromBrief(text), SERVICE_FALLBACKS, SERVICE_FALLBACKS.length);
  // Never seeded from `services` — a differentiator is a distinct unique-selling-point claim, not
  // a restatement of the offering list. Sharing that seed produced identical title/body text on
  // the same card (confirmed live: a service card titled "Colorado." with body text "Colorado.").
  const differentiators = padList([], DIFFERENTIATOR_FALLBACKS, DIFFERENTIATOR_FALLBACKS.length);

  return ExpandedBriefSchema.parse({
    businessName: name,
    tagline,
    elevatorPitch: text.length > 40 ? text.slice(0, 280) : `${name} — ${tagline}.`,
    expandedBrief: text,
    targetAudience: `People looking for ${name}`,
    services,
    differentiators,
    tone: "direct and specific",
    primaryCta: "Get in touch",
    secondaryCta: "Learn more",
  });
}

function mockExpand(rawBrief: string, businessName?: string): ExpandedBrief {
  return expandBriefFromInput(rawBrief, businessName);
}

export async function expandBrief(
  rawBrief: string,
  businessName?: string
): Promise<ExpandedBrief> {
  requireLlm("expand brief");

  if (llm.isAvailable) {
    try {
      return await chatJsonWithRetry(
        "expand_brief",
        EXPAND_SYSTEM,
        (parseError) =>
          `User input:\n${rawBrief}\n\n${businessName ? `Preferred business name: ${businessName}` : "Extract the business name from the input."}` +
          (parseError ? `\n\nYour previous response was not valid JSON (${parseError}). Return ONLY a single valid JSON object, no prose, no markdown fences.` : ""),
        { temperature: 0.7, tokenRole: "expand" },
        (raw) => ExpandedBriefSchema.parse(normalizeExpandedBrief(parseLlmJson<Record<string, unknown>>(raw)))
      );
    } catch (err) {
      recordFallback("expand_brief");
      if (!allowMocks()) throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!allowMocks()) throw new Error("Expand brief failed");
  return mockExpand(rawBrief, businessName);
}

export function briefToContext(brief: ExpandedBrief): string {
  return `BUSINESS: ${brief.businessName}
TAGLINE: ${brief.tagline}
PITCH: ${brief.elevatorPitch}
BRIEF: ${brief.expandedBrief}
AUDIENCE: ${brief.targetAudience}
SERVICES: ${brief.services.join(", ")}
DIFFERENTIATORS: ${brief.differentiators.join(", ")}
TONE: ${brief.tone}
PRIMARY CTA: ${brief.primaryCta}`;
}
