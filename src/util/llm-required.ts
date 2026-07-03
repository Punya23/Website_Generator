import { llm } from "../llm/client.js";
import { strictQualityRequested } from "../llm/pipeline-speed.js";

export class LlmRequiredError extends Error {
  constructor(step: string) {
    super(
      `LLM required for "${step}". Set OPENROUTER_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, or OPENAI_API_KEY in .env`
    );
    this.name = "LlmRequiredError";
  }
}

export function allowMocks(): boolean {
  if (strictQualityRequested()) return false;
  return process.env.ALLOW_MOCKS === "1" || process.env.NODE_ENV === "test";
}

export function strictLlmRequired(): boolean {
  return strictQualityRequested();
}

export function requireLlm(step: string): void {
  if (!llm.isAvailable && !allowMocks()) {
    throw new LlmRequiredError(step);
  }
}

/** In quality mode, rethrow LLM failures instead of falling back to mocks. */
export function handleLlmFailure(step: string, err: unknown): never {
  if (strictLlmRequired()) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM failed for "${step}" (quality mode — no mock fallback): ${msg}`, {
      cause: err,
    });
  }
  throw err instanceof Error ? err : new Error(String(err));
}
