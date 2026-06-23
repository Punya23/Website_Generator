/**
 * Curated Unsplash photos (free to hotlink per Unsplash guidelines).
 * Format: photo-{timestamp}-{hash}
 */
const STOCK_BY_VERTICAL: Record<string, string[]> = {
  salon: [
    "photo-1560066984-138dadb4c035",
    "photo-1522337360788-8b13dee7a37e",
    "photo-1633681926020-7e5c736a0b0e",
    "photo-1595476108010-b4d1f102b68b",
    "photo-1519699047748-de8e457a634e",
  ],
  finserv: [
    "photo-1556761175-5973dc0f32e7",
    "photo-1460925895917-afdab827c52f",
    "photo-1551836022-deb4988ff408",
    "photo-1486406146926-c627a92ad1ab",
    "photo-1454165804606-c3d57bc86b40",
  ],
  restaurant: [
    "photo-1414235077428-338989a2e8c0",
    "photo-1517248135467-4c7edcad34c4",
    "photo-1559339352-11d035aa65de",
    "photo-1550966871-3ed3cdb5ed0b",
    "photo-1424847651672-bf20a4b0982b",
  ],
  fitness: [
    "photo-1534438327276-14e5300c3a48",
    "photo-1571019614242-c5c5dee9f50b",
    "photo-1517836357463-d25dfeac3438",
    "photo-1540497077202-7a8aa3e99126",
    "photo-1583454110551-21f2fa2afe61",
  ],
  default: [
    "photo-1497366216548-37526070297c",
    "photo-1497215728101-856f4ea42174",
    "photo-1552664730-d307ca884978",
    "photo-1600880292203-757bb62b4baf",
    "photo-1553877522-43269d4ea984",
  ],
};

const QUERY_MAP: Array<{ pattern: RegExp; vertical: string }> = [
  { pattern: /hair|salon|cut|color|balayage|stylist/i, vertical: "salon" },
  { pattern: /finance|wealth|invest|money|portfolio/i, vertical: "finserv" },
  { pattern: /food|restaurant|dining|chef|menu/i, vertical: "restaurant" },
  { pattern: /gym|fitness|workout|yoga|train/i, vertical: "fitness" },
  { pattern: /team|office|meeting|business/i, vertical: "default" },
];

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickPhotoId(vertical: string, seed: string): string {
  const pool = STOCK_BY_VERTICAL[vertical] ?? STOCK_BY_VERTICAL.default!;
  return pool[hashSeed(seed) % pool.length]!;
}

function resolveVertical(query: string, fallback: string): string {
  for (const { pattern, vertical } of QUERY_MAP) {
    if (pattern.test(query)) return vertical;
  }
  return fallback;
}

export function stockImageUrl(
  query: string,
  seed: string,
  vertical = "default",
  width = 1200,
  height = 800
): string {
  const v = resolveVertical(query, vertical);
  const photoId = pickPhotoId(v, `${seed}-${query}`);
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=${width}&h=${height}&q=80`;
}

export function heroImageUrl(businessName: string, brief: string, vertical: string): string {
  return stockImageUrl(`${brief} ${businessName} hero`, businessName, vertical, 1600, 900);
}
