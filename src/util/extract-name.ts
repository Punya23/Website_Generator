export function extractBusinessName(brief: string): string {
  const quoted = brief.match(/(?:called|named)\s+["']([^"']+)["']/i);
  if (quoted?.[1]) return quoted[1];

  const beforeDash = brief.match(/^([A-Za-z0-9][A-Za-z0-9\s.'&]{1,40}?)\s*[-—:]/);
  if (beforeDash?.[1]) return beforeDash[1].trim();

  const patterns = [
    /^([A-Z][A-Za-z0-9&'\s]{2,30}?)\s+(?:is|—|-|:)/,
    /^([A-Z][A-Za-z0-9&'\s]{2,28})$/,
  ];
  for (const p of patterns) {
    const m = brief.match(p);
    if (m?.[1]) return m[1].trim();
  }

  const words = brief.split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
  const base = words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return base || "My Business";
}
