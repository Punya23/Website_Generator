import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isBudgetMode,
  isVisionEnabled,
  llmMaxRetries,
  maxTokensFor,
  clampRequestMaxTokens,
  resolveRequestMaxTokens,
  shouldUseLlmCopy,
} from "../src/llm/token-budget.js";

describe("token budget", () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_BUDGET_MODE;
    delete process.env.SKIP_VISION;
    delete process.env.LLM_MAX_RETRIES;
    delete process.env.LLM_MAX_TOKENS;
    delete process.env.OPENROUTER_MAX_TOKENS;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("budget mode is opt-in only", () => {
    expect(isBudgetMode()).toBe(false);
    process.env.LLM_BUDGET_MODE = "1";
    expect(isBudgetMode()).toBe(true);
    process.env.LLM_BUDGET_MODE = "0";
    expect(isBudgetMode()).toBe(false);
  });

  it("vision stays enabled unless SKIP_VISION=1", () => {
    expect(isVisionEnabled()).toBe(true);
    process.env.LLM_BUDGET_MODE = "1";
    expect(isVisionEnabled()).toBe(true);
    process.env.SKIP_VISION = "1";
    expect(isVisionEnabled()).toBe(false);
  });

  it("uses quality-first token caps by default", () => {
    expect(maxTokensFor("section")).toBe(2048);
    expect(maxTokensFor("composition")).toBe(3072);
    process.env.LLM_BUDGET_MODE = "1";
    expect(maxTokensFor("section")).toBe(1024);
  });

  it("defaults max retries to 4", () => {
    expect(llmMaxRetries()).toBe(4);
    process.env.LLM_MAX_RETRIES = "2";
    expect(llmMaxRetries()).toBe(2);
  });

  it("budget mode limits copy LLM to hero/cta sections", () => {
    expect(shouldUseLlmCopy("services_showcase", "home")).toBe(true);
    process.env.LLM_BUDGET_MODE = "1";
    expect(shouldUseLlmCopy("services_showcase", "home")).toBe(false);
    expect(shouldUseLlmCopy("hero_editorial", "home")).toBe(true);
    expect(shouldUseLlmCopy("intro_statement", "home")).toBe(true);
  });

  it("clamps OpenRouter max_tokens to safe prepaid cap", () => {
    expect(clampRequestMaxTokens(4096, "openrouter")).toBe(2048);
    expect(clampRequestMaxTokens(4096, "groq")).toBe(4096);
    process.env.OPENROUTER_MAX_TOKENS = "1536";
    expect(resolveRequestMaxTokens({ maxTokens: 4096 }, "openrouter")).toBe(1536);
    expect(resolveRequestMaxTokens({ tokenRole: "section" }, "openrouter")).toBe(1536);
  });

  it("gives plan, architect, composition, and page roles 3072 floor on OpenRouter", () => {
    process.env.OPENROUTER_MAX_TOKENS = "2048";
    expect(resolveRequestMaxTokens({ tokenRole: "plan" }, "openrouter")).toBe(3072);
    expect(resolveRequestMaxTokens({ tokenRole: "architect" }, "openrouter")).toBe(3072);
    expect(resolveRequestMaxTokens({ tokenRole: "composition" }, "openrouter")).toBe(3072);
    expect(resolveRequestMaxTokens({ tokenRole: "page" }, "openrouter")).toBe(3072);
    expect(resolveRequestMaxTokens({ tokenRole: "section" }, "openrouter")).toBe(2048);
  });
});
