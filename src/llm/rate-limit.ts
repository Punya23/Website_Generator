const RATE_LIMIT_RE = /rate limit|429|tokens per minute|tpm/i;
const OVER_CAPACITY_RE = /over capacity|temporarily unavailable|service unavailable/i;
const CONNECTION_ERROR_RE =
  /connection error|connection timeout|econnreset|etimedout|fetch failed|socket hang up|network/i;
const RETRY_AFTER_RE = /try again in ([\d.]+)s/i;

export const DEFAULT_GROQ_FALLBACK_MODEL = "llama-3.1-8b-instant";

export function groqFallbackModel(current: string): string | null {
  const fallback = process.env.GROQ_FALLBACK_MODEL ?? DEFAULT_GROQ_FALLBACK_MODEL;
  return fallback === current ? null : fallback;
}

const INSUFFICIENT_CREDITS_RE =
  /requires more credits|insufficient credits|insufficient_quota|payment required|exceeded your current quota/i;

export function isInsufficientCreditsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? err.status : undefined;
  if (status === 402 || status === 401) return true;
  return INSUFFICIENT_CREDITS_RE.test(extractErrorMessage(err));
}

/** Do not retry billing/auth errors — each attempt may still charge or waste time. */
export function isNonRetryableLLMError(err: unknown): boolean {
  return isInsufficientCreditsError(err);
}

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? err.status : undefined;
  if (status === 429) return true;
  const message = extractErrorMessage(err);
  return RATE_LIMIT_RE.test(message);
}

export function isOverCapacityError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? err.status : undefined;
  if (status === 503) return true;
  return OVER_CAPACITY_RE.test(extractErrorMessage(err));
}

export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("name" in err && String(err.name) === "APIConnectionError") return true;
  if ("name" in err && String(err.name) === "APIConnectionTimeoutError") return true;
  return CONNECTION_ERROR_RE.test(extractErrorMessage(err));
}

/** Transient Groq/OpenAI-style errors worth retrying (429, 502, 503, 504, connection drops). */
export function isTransientLLMError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? err.status : undefined;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  const message = extractErrorMessage(err);
  if (CONNECTION_ERROR_RE.test(message)) return true;
  if ("name" in err && String(err.name) === "APIConnectionError") return true;
  if ("name" in err && String(err.name) === "APIConnectionTimeoutError") return true;
  return RATE_LIMIT_RE.test(message) || OVER_CAPACITY_RE.test(message);
}

export function parseRetryAfterMs(err: unknown, attempt: number): number {
  const message = extractErrorMessage(err);
  const match = message.match(RETRY_AFTER_RE);
  if (match?.[1]) {
    const seconds = Number.parseFloat(match[1]);
    if (Number.isFinite(seconds)) {
      return Math.ceil(seconds * 1000) + 750;
    }
  }
  return Math.min(60_000, 2000 * 2 ** attempt);
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String(err.message);
  }
  return String(err);
}
