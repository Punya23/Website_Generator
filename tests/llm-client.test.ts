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
    delete process.env.OPENROUTER_API_KEY;
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

  it("Groq supports vision with default scout model", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const { llm } = await import("../src/llm/client.js");
    expect(llm.supportsVision).toBe(true);
    expect(llm.getVisionModel()).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
  });

  it("Groq section model defaults to 8b-instant", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const { llm } = await import("../src/llm/client.js");
    expect(llm.getSectionModel()).toBe("llama-3.1-8b-instant");
    expect(llm.getCompositionModel()).toBe("llama-3.3-70b-versatile");
  });

  it("allows custom Groq model via env", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.GROQ_MODEL = "llama-3.1-8b-instant";
    const { llm } = await import("../src/llm/client.js");
    expect(llm.getChatModel()).toBe("llama-3.1-8b-instant");
  });

  it("uses OpenRouter when LLM_PROVIDER=openrouter", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_PROVIDER = "openrouter";
    const { resolveProvider, llm } = await import("../src/llm/client.js");
    expect(resolveProvider()).toBe("openrouter");
    expect(llm.provider).toBe("openrouter");
    expect(llm.getCompositionModel()).toBe("google/gemini-2.5-flash");
    expect(llm.getSectionModel()).toBe("google/gemini-2.5-flash-lite");
    expect(llm.supportsVision).toBe(true);
    expect(llm.getVisionModel()).toBe("google/gemini-2.5-flash");
  });

  it("OpenRouter respects LLM_PROVIDER over Groq key", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_PROVIDER = "openrouter";
    const { resolveProvider, llm } = await import("../src/llm/client.js");
    expect(resolveProvider()).toBe("openrouter");
    expect(llm.provider).toBe("openrouter");
  });

  it("bespoke codegen defaults to the fast section model, not the slow GLM hero-codegen model", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_MODEL_TIER = "premium";
    const { llm } = await import("../src/llm/client.js");
    // premium tier: heroCodegen is the slow GLM model, section is fast Gemini Flash.
    expect(llm.getHeroCodegenModel()).toBe("z-ai/glm-4.6");
    expect(llm.getBespokeCodegenModel()).toBe(llm.getSectionModel());
    expect(llm.getBespokeCodegenModel()).not.toBe("z-ai/glm-4.6");
  });

  it("bespoke codegen model can be explicitly overridden", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_BESPOKE_CODEGEN_MODEL = "z-ai/glm-4.6";
    const { llm } = await import("../src/llm/client.js");
    expect(llm.getBespokeCodegenModel()).toBe("z-ai/glm-4.6");
  });
});
