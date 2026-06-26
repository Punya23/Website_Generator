import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProvider, DEFAULT_MODELS } from "../src/llm/client.js";

describe("ollama provider", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MISTRAL_API_KEY;
  });

  it("resolves when LLM_PROVIDER=ollama", () => {
    process.env.LLM_PROVIDER = "ollama";
    expect(resolveProvider()).toBe("ollama");
  });

  it("has sensible default models", () => {
    expect(DEFAULT_MODELS.ollama.chat).toBe("llama3.1:8b");
    expect(DEFAULT_MODELS.ollama.vision).toBeNull();
  });
});
