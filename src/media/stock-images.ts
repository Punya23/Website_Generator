import { resolveImageUrl, resolveImageUrlSync } from "./image-providers.js";

export async function stockImageUrl(
  query: string,
  seed: string,
  _vertical?: string,
  width = 1200,
  height = 800
): Promise<string> {
  return resolveImageUrl({ query, seed, width, height });
}

export function stockImageUrlSync(
  query: string,
  seed: string,
  _vertical?: string,
  width = 1200,
  height = 800
): string {
  return resolveImageUrlSync({ query, seed, width, height });
}

export async function heroImageUrl(
  businessName: string,
  brief: string,
  _vertical?: string
): Promise<string> {
  return stockImageUrl(`${brief} ${businessName}`, businessName, undefined, 1600, 900);
}
