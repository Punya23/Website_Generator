import { llm } from "../llm/client.js";

export class LlmRequiredError extends Error {
  constructor(step: string) {
    super(
      `LLM required for "${step}". Set OPENROUTER_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, or OPENAI_API_KEY in .env`
    );
    this.name = "LlmRequiredError";
  }
}

export function allowMocks(): boolean {
  return process.env.ALLOW_MOCKS === "1" || process.env.NODE_ENV === "test";
}

export function requireLlm(step: string): void {
  if (!llm.isAvailable && !allowMocks()) {
    throw new LlmRequiredError(step);
  }
}
