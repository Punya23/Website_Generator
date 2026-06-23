export async function timedStep<T>(scope: string, label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  process.stdout.write(`[pipeline] ${scope}: ${label}…\n`);
  try {
    const result = await fn();
    console.log(`[pipeline] ${scope}: ${label} done (${formatSeconds(Date.now() - start)})`);
    return result;
  } catch (err) {
    console.log(`[pipeline] ${scope}: ${label} failed (${formatSeconds(Date.now() - start)})`);
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
