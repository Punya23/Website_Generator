/** Rough USD estimates from token usage (OpenRouter list prices per 1M tokens). */

const RATES_PER_MILLION: Record<string, { input: number; output: number }> = {
  "z-ai/glm-4.6": { input: 0.43, output: 1.74 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10 },
  "meta-llama/llama-3.3-70b-instruct:floor": { input: 0.1, output: 0.3 },
};

const DEFAULT_RATE = { input: 0.35, output: 2.0 };

export function modelRates(model: string): { input: number; output: number } {
  const base = model.split(":")[0]!;
  for (const [key, rate] of Object.entries(RATES_PER_MILLION)) {
    if (model === key || model.startsWith(key)) return rate;
  }
  if (model.includes("glm")) return RATES_PER_MILLION["z-ai/glm-4.6"]!;
  if (model.includes("flash-lite")) return RATES_PER_MILLION["google/gemini-2.5-flash-lite"]!;
  if (model.includes("flash")) return RATES_PER_MILLION["google/gemini-2.5-flash"]!;
  return DEFAULT_RATE;
}

export function estimateCostUsd(
  usageByModel: Map<string, { prompt: number; completion: number }>
): number {
  let total = 0;
  for (const [model, u] of usageByModel) {
    const rate = modelRates(model);
    total += (u.prompt / 1_000_000) * rate.input + (u.completion / 1_000_000) * rate.output;
  }
  return total;
}

export function pipelineCostCapUsd(): number | null {
  const n = Number.parseFloat(process.env.PIPELINE_COST_CAP_USD ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isOverCostCap(estimatedUsd: number): boolean {
  const cap = pipelineCostCapUsd();
  return cap !== null && estimatedUsd >= cap;
}
