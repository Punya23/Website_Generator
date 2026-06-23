import { describe, it, expect } from "vitest";
import { isRateLimitError, parseRetryAfterMs } from "../src/llm/rate-limit.js";

describe("rate limit helpers", () => {
  it("detects Groq 429 messages", () => {
    const err = new Error(
      "429 Rate limit reached for model `llama-3.3-70b-versatile` ... Please try again in 15.61s."
    );
    expect(isRateLimitError(err)).toBe(true);
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
});
