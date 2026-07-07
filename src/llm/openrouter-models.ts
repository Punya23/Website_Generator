/**
 * OpenRouter model tiers for full-site generation.
 *
 * Budget: ~$0.05–0.20/site (35–50k tokens)
 * Balanced / Premium: ~$0.25–0.45/site — GLM architect + Gemini Flash (quality pipeline)
 * Quality: legacy upgrade path (Llama 70B composition)
 */

export const OPENROUTER_BUDGET_MODELS = {
  architect: "google/gemini-2.5-flash",
  composition: "google/gemini-2.5-flash",
  chat: "google/gemini-2.5-flash",
  section: "google/gemini-2.5-flash-lite",
  page: "google/gemini-2.5-flash",
  vision: "google/gemini-2.5-flash",
  heroCodegen: "google/gemini-2.5-flash",
} as const;

/** GLM 4.6 for architecture/codegen + Gemini Flash for copy/directors — target under $0.40/site */
export const OPENROUTER_BALANCED_MODELS = {
  architect: "z-ai/glm-4.6",
  composition: "z-ai/glm-4.6",
  chat: "google/gemini-2.5-flash",
  section: "google/gemini-2.5-flash",
  page: "anthropic/claude-sonnet-4",
  vision: "google/gemini-2.5-flash",
  heroCodegen: "z-ai/glm-4.6",
  design: "google/gemini-2.5-flash",
  refine: "google/gemini-2.5-flash",
  plan: "google/gemini-2.5-flash",
  expand: "google/gemini-2.5-flash",
} as const;

/** Best quality within ~$0.45/site — GLM for structure/code, Flash for all copy/design */
export const OPENROUTER_PREMIUM_MODELS = {
  architect: "z-ai/glm-4.6",
  composition: "z-ai/glm-4.6",
  chat: "google/gemini-2.5-flash",
  section: "google/gemini-2.5-flash",
  page: "anthropic/claude-sonnet-4",
  vision: "google/gemini-2.5-flash",
  heroCodegen: "z-ai/glm-4.6",
  design: "google/gemini-2.5-flash",
  refine: "google/gemini-2.5-flash",
  plan: "google/gemini-2.5-flash",
  expand: "google/gemini-2.5-flash",
} as const;

/** Higher quality legacy tier */
export const OPENROUTER_QUALITY_MODELS = {
  architect: "meta-llama/llama-3.3-70b-instruct:floor",
  composition: "meta-llama/llama-3.3-70b-instruct:floor",
  chat: "google/gemini-2.5-flash",
  section: "google/gemini-2.5-flash",
  page: "google/gemini-2.5-flash",
  vision: "google/gemini-2.5-flash",
  heroCodegen: "google/gemini-2.5-flash",
} as const;

export type OpenRouterModelSet =
  | typeof OPENROUTER_BUDGET_MODELS
  | typeof OPENROUTER_BALANCED_MODELS
  | typeof OPENROUTER_PREMIUM_MODELS
  | typeof OPENROUTER_QUALITY_MODELS;

export function openRouterDefaults(): OpenRouterModelSet {
  const tier = process.env.OPENROUTER_MODEL_TIER?.toLowerCase();
  if (tier === "premium") return OPENROUTER_PREMIUM_MODELS;
  if (tier === "balanced") return OPENROUTER_BALANCED_MODELS;
  if (tier === "quality") return OPENROUTER_QUALITY_MODELS;
  return OPENROUTER_BUDGET_MODELS;
}

/** Downgrade target when PIPELINE_COST_CAP_USD is exceeded */
export const OPENROUTER_COST_DOWNGRADE_MODEL = "google/gemini-2.5-flash";
