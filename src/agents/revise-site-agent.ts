import { llm } from "../llm/client.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { isBlockedHost } from "../admin/policy.js";
import type { SiteContext } from "../types.js";
import {
  RevisionPatchSchema,
  catalogForRevision,
  type RevisionPatch,
} from "../editor/apply-revision.js";

const REVISE_SYSTEM = `You revise an existing marketing website by returning ONE JSON patch.
The layout is a frozen React section library. You never invent CSS, HTML, or new template ids.
You never add ecommerce, carts, Stripe, login, membership, databases, or custom backends.
You never clone Framer, Webflow, ThemeForest, Cruip, or Tailwind Plus.

Return JSON only:
{
  "kind": "theme" | "copy" | "reorder" | "swap" | "insert" | "remove" | "refuse",
  "summary": "short what you did",
  "reason": "required when kind=refuse",
  "theme": { "colors": { "accent": "#hex" }, "fontHeading": "Name", "mood": "…", "navShape": "full-width|floating-capsule|floating-panel|split-inline" },
  "pageSlug": "home|about|services|contact",
  "sectionId": "existing id",
  "props": { "headline": "…" },
  "sectionIds": ["id1","id2"],
  "templateId": "faq_accordion",
  "intent": "Questions",
  "afterSectionId": "optional",
  "index": 2
}

Rules:
- theme: only token fields listed above
- copy: merge visitor-facing props on an existing sectionId (no layoutVariant/density/form backend keys)
- reorder: sectionIds must list every section on that page
- swap: templateId must be in TEMPLATES; hero_* only swaps with hero_*
- insert: templateId in TEMPLATES, never a second hero; keep page length in bounds
- remove: keep min sections; do not remove the only hero or only cta_band/footer_cta
- refuse: anything that needs a store, accounts, backend, or cloning a blocked URL
`;

const STORE_RE =
  /\b(e-?commerce|shopping cart|add to cart|stripe checkout|shopify|woocommerce|payment gateway|online store)\b/i;
const AUTH_RE =
  /\b(user accounts?|membership area|login wall|sign[- ]up system|auth0|oauth)\b/i;
const BACKEND_RE =
  /\b(postgres|mongodb|mysql|database|fastapi|django backend|express api|server-side db)\b/i;
const CLONE_RE =
  /\b(clone|copy|scrape|steal|replicate)\b.*\b(framer|webflow|themeforest|cruip|tailwind plus|tailwind ui)\b/i;
const CLONE_RE_REV =
  /\b(framer|webflow|themeforest|cruip|tailwind plus|tailwind ui)\b.*\b(clone|copy|scrape|steal|replicate)\b/i;

function refuse(summary: string, reason: string): RevisionPatch {
  return { kind: "refuse", summary, reason };
}

export function detectHardRefuse(message: string): RevisionPatch | null {
  const urls = message.match(/https?:\/\/[^\s)>\]]+/gi) ?? [];
  for (const url of urls) {
    if (isBlockedHost(url)) {
      return refuse(
        "Blocked source",
        "We do not clone Framer, Webflow, or paid kit URLs. Describe the change in words instead."
      );
    }
  }
  if (CLONE_RE.test(message) || CLONE_RE_REV.test(message)) {
    return refuse(
      "Blocked source",
      "We do not clone Framer, Webflow, or paid kits. Ask for a copy or layout change instead."
    );
  }
  if (STORE_RE.test(message)) {
    return refuse(
      "No commerce",
      "This generator does not add a store or payments. Use the contact form and quote calculator."
    );
  }
  if (AUTH_RE.test(message)) {
    return refuse(
      "No accounts",
      "Generated sites are static frontends with no login or membership area."
    );
  }
  if (BACKEND_RE.test(message)) {
    return refuse(
      "No backend",
      "Generated sites have no database. Contact forms post to Web3Forms or FormSubmit."
    );
  }
  return null;
}

function parsePatch(raw: string): RevisionPatch {
  const parsed = parseLlmJson(raw);
  return RevisionPatchSchema.parse(parsed);
}

export async function planRevision(ctx: SiteContext, message: string): Promise<RevisionPatch> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Revision message is required");

  const blocked = detectHardRefuse(trimmed);
  if (blocked) return blocked;

  requireLlm("site revision");

  if (!llm.isAvailable) {
    if (allowMocks()) {
      return refuse(
        "No LLM",
        "Set a free LLM key (GROQ_API_KEY or similar) to apply conversational revisions."
      );
    }
    throw new Error("LLM required to revise the site");
  }

  return chatJsonWithRetry(
    "site revision",
    REVISE_SYSTEM,
    (parseError) => {
      const retry = parseError ? `\n\nPRIOR JSON FAILED: ${parseError}\nReturn valid JSON only.` : "";
      return `Business: ${ctx.businessName}
Brief: ${ctx.expandedBrief.elevatorPitch}

CURRENT SITE:
${catalogForRevision(ctx)}

USER REQUEST:
${trimmed}
${retry}`;
    },
    {
      tokenRole: "composition",
      temperature: 0.3,
      maxAttempts: 2,
    },
    parsePatch
  );
}

export { RevisionPatchSchema };
export type { RevisionPatch };
