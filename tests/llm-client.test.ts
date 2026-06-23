import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("LLM client provider resolution", () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
    delete process.env.GROQ_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    process.env = env;
  });

  it("prefers Groq when GROQ_API_KEY is set", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const { resolveProvider, llm } = await import("../src/llm/client.js");
    expect(resolveProvider()).toBe("groq");
    expect(llm.provider).toBe("groq");
    expect(llm.getChatModel()).toBe("llama-3.3-70b-versatile");
  });

  it("auto-migrates deprecated llama-3.1-70b-versatile", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GROQ_MODEL = "llama-3.1-70b-versatile";
    const { llm } = await import("../src/llm/client.js");
    expect(llm.getChatModel()).toBe("llama-3.3-70b-versatile");
  });

  it("uses OpenAI when only OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { resolveProvider, llm } = await import("../src/llm/client.js");
    expect(resolveProvider()).toBe("openai");
    expect(llm.provider).toBe("openai");
  });

  it("respects LLM_PROVIDER=mistral over Groq key", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.MISTRAL_API_KEY = "mistral_test";
    process.env.LLM_PROVIDER = "mistral";
    const { resolveProvider, llm } = await import("../src/llm/client.js");
    expect(resolveProvider()).toBe("mistral");
    expect(llm.provider).toBe("mistral");
    expect(llm.getChatModel()).toBe("mistral-medium-latest");
    expect(llm.supportsVision).toBe(true);
  });

  it("respects LLM_PROVIDER=openai over Groq key", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.LLM_PROVIDER = "openai";
    const { resolveProvider, llm } = await import("../src/llm/client.js");
    expect(resolveProvider()).toBe("openai");
    expect(llm.provider).toBe("openai");
  });

  it("Groq does not support vision by default", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const { llm } = await import("../src/llm/client.js");
    expect(llm.supportsVision).toBe(false);
  });

  it("allows custom Groq model via env", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GROQ_MODEL = "llama-3.1-8b-instant";
    const { llm } = await import("../src/llm/client.js");
    expect(llm.getChatModel()).toBe("llama-3.1-8b-instant");
  });
});
