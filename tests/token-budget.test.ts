import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isBudgetMode,
  isVisionEnabled,
  llmMaxRetries,
  maxTokensFor,
  shouldUseLlmCopy,
} from "../src/llm/token-budget.js";

describe("token budget", () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_BUDGET_MODE;
    delete process.env.SKIP_VISION;
    delete process.env.LLM_MAX_RETRIES;
    delete process.env.LLM_MAX_TOKENS;
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
});
