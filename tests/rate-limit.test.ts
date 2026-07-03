import { describe, it, expect } from "vitest";
import {
  groqFallbackModel,
  isInsufficientCreditsError,
  isNonRetryableLLMError,
  isOverCapacityError,
  isRateLimitError,
  isTransientLLMError,
  parseAffordableMaxTokens,
  parseRetryAfterMs,
} from "../src/llm/rate-limit.js";

describe("rate limit helpers", () => {
  it("detects Groq 429 messages", () => {
    const err = new Error(
      "429 Rate limit reached for model `llama-3.3-70b-versatile` ... Please try again in 15.61s."
    );
    expect(isRateLimitError(err)).toBe(true);
    expect(isTransientLLMError(err)).toBe(true);
  });

  it("detects Groq 503 over-capacity messages", () => {
    const err = Object.assign(new Error("503 llama-3.3-70b-versatile is currently over capacity"), {
      status: 503,
    });
    expect(isOverCapacityError(err)).toBe(true);
    expect(isTransientLLMError(err)).toBe(true);
    expect(isRateLimitError(err)).toBe(false);
  });

  it("parses retry-after seconds from Groq error", () => {
    const err = new Error("Please try again in 2.39s. Need more tokens?");
    expect(parseRetryAfterMs(err, 0)).toBeGreaterThanOrEqual(3000);
    expect(parseRetryAfterMs(err, 0)).toBeLessThanOrEqual(4000);
  });

  it("uses exponential backoff when no hint", () => {
    const err = new Error("429 Too Many Requests");
    expect(parseRetryAfterMs(err, 2)).toBe(8000);
  });

  it("detects connection errors for retry", () => {
    const err = Object.assign(new Error("Connection error."), { name: "APIConnectionError" });
    expect(isTransientLLMError(err)).toBe(true);
  });

  it("returns a different Groq fallback model", () => {
    expect(groqFallbackModel("llama-3.3-70b-versatile")).toBe("llama-3.1-8b-instant");
    expect(groqFallbackModel("llama-3.1-8b-instant")).toBeNull();
  });

  it("does not retry billing or auth errors", () => {
    const err402 = Object.assign(new Error("requires more credits"), { status: 402 });
    expect(isInsufficientCreditsError(err402)).toBe(true);
    expect(isNonRetryableLLMError(err402)).toBe(true);
    expect(isTransientLLMError(err402)).toBe(false);
  });

  it("retries OpenRouter max_tokens cap 402 with affordable hint", () => {
    const err = Object.assign(
      new Error(
        "402 This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 3301."
      ),
      { status: 402 }
    );
    expect(isInsufficientCreditsError(err)).toBe(true);
    expect(isNonRetryableLLMError(err)).toBe(false);
    expect(parseAffordableMaxTokens(err)).toBe(3301);
  });
});
