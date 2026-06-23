const RATE_LIMIT_RE = /rate limit|429|tokens per minute|tpm/i;
const RETRY_AFTER_RE = /try again in ([\d.]+)s/i;

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? err.status : undefined;
  if (status === 429) return true;
  const message = extractErrorMessage(err);
  return RATE_LIMIT_RE.test(message);
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
