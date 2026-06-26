/** Deterministic variation helpers for regen diversity. */

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickIndex(seed: number | string, key: string, count: number): number {
  if (count <= 0) return 0;
  const n = typeof seed === "number" ? seed : hashString(String(seed));
  return (hashString(`${n}:${key}`) >>> 0) % count;
}

export function pickFrom<T>(seed: number | string, key: string, items: T[]): T {
  return items[pickIndex(seed, key, items.length)]!;
}
