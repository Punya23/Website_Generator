import { pipelineLog } from "./pipeline-log.js";

export async function timedStep<T>(scope: string, label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  pipelineLog(`[pipeline] ${scope}: ${label}…`);
  try {
    const result = await fn();
    pipelineLog(`[pipeline] ${scope}: ${label} done (${formatSeconds(Date.now() - start)})`);
    return result;
  } catch (err) {
    pipelineLog(`[pipeline] ${scope}: ${label} failed (${formatSeconds(Date.now() - start)})`);
    throw err;
  }
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${(ms / 1000).toFixed(0)}s`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
