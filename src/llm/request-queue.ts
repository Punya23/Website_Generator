type Task<T> = () => Promise<T>;

function parseConcurrency(): number {
  const raw = process.env.LLM_MAX_CONCURRENCY ?? process.env.GROQ_MAX_CONCURRENCY;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY ? 1 : 4;
}

function parseGroqDelayMs(): number {
  const raw = process.env.GROQ_REQUEST_DELAY_MS ?? process.env.LLM_REQUEST_DELAY_MS;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return process.env.GROQ_API_KEY ? 400 : 0;
}

export class LlmRequestQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly delayAfterMs: number
  ) {}

  async run<T>(task: Task<T>): Promise<T> {
    await this.acquire();
    try {
      const result = await task();
      if (this.delayAfterMs > 0) {
        await sleep(this.delayAfterMs);
      }
      return result;
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const llmQueue = new LlmRequestQueue(parseConcurrency(), parseGroqDelayMs());
