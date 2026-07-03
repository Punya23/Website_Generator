import {
  defaultLlmConcurrency,
  defaultLlmRequestDelayMs,
  bespokeCodegenConcurrency,
  bespokeCodegenRequestDelayMs,
} from "./pipeline-speed.js";

type Task<T> = () => Promise<T>;

function parseConcurrency(): number {
  return defaultLlmConcurrency();
}

function parseRequestDelayMs(): number {
  return defaultLlmRequestDelayMs();
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

export const llmQueue = new LlmRequestQueue(parseConcurrency(), parseRequestDelayMs());

/** Separate, higher-concurrency queue for bespoke section codegen — see
 *  bespokeCodegenConcurrency() for why this isn't just a bigger shared queue. */
export const bespokeCodegenQueue = new LlmRequestQueue(
  bespokeCodegenConcurrency(),
  bespokeCodegenRequestDelayMs()
);
