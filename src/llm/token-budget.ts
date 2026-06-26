/**
 * Token / retry helpers. Quality-first by default; aggressive savings only when
 * LLM_BUDGET_MODE=1 (opt-in).
 */

export type TokenRole = "expand" | "plan" | "composition" | "section" | "design" | "refine";

/** Aggressive call-skipping — opt-in only via LLM_BUDGET_MODE=1. */
export function isBudgetMode(): boolean {
  return process.env.LLM_BUDGET_MODE === "1";
}

export function isVisionEnabled(): boolean {
  return process.env.SKIP_VISION !== "1";
}

export function llmMaxRetries(): number {
  const n = Number.parseInt(process.env.LLM_MAX_RETRIES ?? "4", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 8) : 4;
}

export function maxTokensFor(role: TokenRole): number {
  const env = Number.parseInt(process.env.LLM_MAX_TOKENS ?? "", 10);
  if (Number.isFinite(env) && env > 0) return env;

  if (isBudgetMode()) {
    const budget: Record<TokenRole, number> = {
      expand: 1536,
      plan: 1536,
      composition: 1536,
      section: 1024,
      design: 1024,
      refine: 1024,
    };
    return budget[role];
  }

  const standard: Record<TokenRole, number> = {
    expand: 3072,
    plan: 3072,
    composition: 3072,
    section: 2048,
    design: 2048,
    refine: 2048,
  };
  return standard[role];
}

/** Templates that get real LLM copy in budget mode (rest use profile mocks). */
const BUDGET_LLM_COPY = /^hero_|cta_band|footer_cta$/;

export function shouldUseLlmCopy(templateId: string, pageSlug: string): boolean {
  if (!isBudgetMode()) return true;
  if (BUDGET_LLM_COPY.test(templateId)) return true;
  if (templateId === "intro_statement" && pageSlug === "home") return true;
  return false;
}

export function shouldUseLlmDesignSystem(): boolean {
  return !isBudgetMode() || process.env.LLM_BUDGET_DESIGN === "1";
}

export function shouldUseLlmDirectors(): boolean {
  return !isBudgetMode() || process.env.LLM_BUDGET_DIRECTORS === "1";
}

export function shouldUseLlmCreativeDirector(): boolean {
  return !isBudgetMode() || process.env.LLM_BUDGET_CREATIVE === "1";
}
