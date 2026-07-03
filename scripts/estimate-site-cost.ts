/** Dry-run cost estimate for quality pipeline (balanced tier). */
import "../src/load-env.js";
import { OPENROUTER_BALANCED_MODELS } from "../src/llm/openrouter-models.js";
import { estimateCostUsd } from "../src/llm/cost-telemetry.js";

const TYPICAL_USAGE = new Map([
  [OPENROUTER_BALANCED_MODELS.architect, { prompt: 8_000, completion: 3_500 }],
  [OPENROUTER_BALANCED_MODELS.composition, { prompt: 6_000, completion: 2_000 }],
  [OPENROUTER_BALANCED_MODELS.chat, { prompt: 5_000, completion: 2_500 }],
  [OPENROUTER_BALANCED_MODELS.section, { prompt: 28_000, completion: 10_000 }],
  [OPENROUTER_BALANCED_MODELS.vision, { prompt: 3_000, completion: 800 }],
  [OPENROUTER_BALANCED_MODELS.heroCodegen, { prompt: 4_000, completion: 2_500 }],
]);

const totalTokens = [...TYPICAL_USAGE.values()].reduce(
  (sum, u) => sum + u.prompt + u.completion,
  0
);
const cost = estimateCostUsd(TYPICAL_USAGE);

console.log("Quality pipeline (balanced tier) — typical site estimate");
console.log("Models:", OPENROUTER_BALANCED_MODELS);
console.log(`Tokens: ~${totalTokens.toLocaleString()}`);
console.log(`Estimated cost: ~$${cost.toFixed(3)} / site`);
console.log(`Target cap: $${process.env.PIPELINE_COST_CAP_USD ?? "0.40"} (set PIPELINE_COST_CAP_USD)`);
