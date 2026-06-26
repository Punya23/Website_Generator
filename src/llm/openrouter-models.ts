/**
 * Budget-oriented OpenRouter defaults for full-site generation.
 *
 * Typical React pipeline: ~35–50k tokens/site.
 * Rough cost with these models: ~$0.05–0.20/site (vision adds ~$0.01–0.03).
 * $5 credit ≈ 25–80 sites depending on vision + CUSTOM_HERO_CODEGEN.
 *
 * Pricing refs: https://openrouter.ai/models (sort by pricing-low-to-high)
 * Append :floor to a slug to route to the cheapest provider for that model.
 */
export const OPENROUTER_BUDGET_MODELS = {
  /** Site plan, creative director, layout/motion/chrome directors */
  composition: "google/gemini-2.5-flash",
  /** General chat / brief expand */
  chat: "google/gemini-2.5-flash",
  /** Per-section copy + media (many parallel calls — keep cheap) */
  section: "google/gemini-2.5-flash-lite",
  /** Vision QA screenshots (multimodal) */
  vision: "google/gemini-2.5-flash",
  /** Optional upgrade for custom hero codegen only */
  heroCodegen: "google/gemini-2.5-flash",
} as const;

/** Higher quality, higher cost — use when budget allows */
export const OPENROUTER_QUALITY_MODELS = {
  composition: "meta-llama/llama-3.3-70b-instruct:floor",
  chat: "google/gemini-2.5-flash",
  section: "google/gemini-2.5-flash",
  vision: "google/gemini-2.5-flash",
  heroCodegen: "google/gemini-2.5-flash",
} as const;

export function openRouterDefaults(): typeof OPENROUTER_BUDGET_MODELS | typeof OPENROUTER_QUALITY_MODELS {
  const tier = process.env.OPENROUTER_MODEL_TIER?.toLowerCase();
  return tier === "quality" ? OPENROUTER_QUALITY_MODELS : OPENROUTER_BUDGET_MODELS;
}
