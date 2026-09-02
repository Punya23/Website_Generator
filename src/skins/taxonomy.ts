/**
 * Skin taxonomy — industry × archetype.
 *
 * Replaces the four coarse regex buckets that both ingest and runtime selection used to share.
 * Classification is deterministic keyword scoring (no LLM): a brief or a template description is
 * reduced to a word set, each industry/archetype scores its matched terms, and the top scorer wins
 * with declared order as the tie-break. The legacy four-value `SkinCategory` is derived from the
 * winning industry so existing skins, pickers, and stored data keep working unchanged.
 *
 * Matching is exact-word (plus literal multi-word phrases), never stem/prefix — "dentistry" does
 * not match the keyword "dentist". Keep it that way: loose stems make unrelated boilerplate in a
 * brief (taglines, service lists) outvote the sentence that actually describes the business.
 */

export const SKIN_CATEGORIES = [
  "local-service",
  "hospitality",
  "professional",
  "creative",
] as const;

export type SkinCategory = (typeof SKIN_CATEGORIES)[number];

/** Page shape a business needs, independent of what industry it is in. */
export const SITE_ARCHETYPES = [
  "portfolio",
  "storefront",
  "booking",
  "long-form",
  "saas",
] as const;

export type SiteArchetype = (typeof SITE_ARCHETYPES)[number];

interface IndustryDef {
  id: string;
  category: SkinCategory;
  /** Archetype assumed when the copy carries no archetype signal of its own. */
  archetype: SiteArchetype;
  strong: string[];
  medium: string[];
  weak: string[];
}

const INDUSTRY_DEFS = [
  // ---- local-service -------------------------------------------------------
  {
    id: "home-services",
    category: "local-service",
    archetype: "booking",
    strong: ["plumber", "plumbing", "hvac", "roofing", "roofer", "electrician", "handyman", "landscaping", "pest"],
    medium: ["contractor", "remodeling", "renovation", "gutter", "septic", "locksmith", "movers", "moving"],
    weak: ["repair", "install", "installation", "emergency", "residential", "estimate"],
  },
  {
    id: "auto-services",
    category: "local-service",
    archetype: "booking",
    strong: ["automotive", "mechanic", "autobody", "detailing", "dealership", "tyre", "tire"],
    medium: ["garage", "collision", "towing", "windshield", "vehicle"],
    weak: ["auto", "car", "cars", "fleet"],
  },
  {
    id: "health-clinic",
    category: "local-service",
    archetype: "booking",
    strong: ["dental", "dentist", "clinic", "orthodontist", "orthodontics", "chiropractor", "chiropractic", "physiotherapy", "podiatry", "optometry"],
    medium: ["medical", "physician", "practice", "dermatology", "pediatric", "veterinary", "optician", "physio", "medspa"],
    weak: ["patients", "treatment", "hygiene", "checkup"],
  },
  {
    id: "beauty-wellness",
    category: "local-service",
    archetype: "booking",
    strong: ["salon", "barber", "barbershop", "spa", "manicure", "nails", "aesthetician", "lashes"],
    medium: ["hairdresser", "stylist", "massage", "facial", "waxing", "grooming", "wellness"],
    weak: ["beauty", "skincare", "relax"],
  },
  {
    id: "fitness",
    category: "local-service",
    archetype: "booking",
    strong: ["gym", "yoga", "pilates", "crossfit", "bootcamp", "martial", "climbing"],
    medium: ["fitness", "trainer", "training", "strength", "conditioning", "cycling"],
    weak: ["classes", "membership", "coach"],
  },
  {
    id: "pet-services",
    category: "local-service",
    archetype: "booking",
    strong: ["kennel", "boarding", "daycare", "petcare"],
    medium: ["dog", "dogs", "cat", "cats", "puppy", "pets"],
    weak: ["pet", "walks", "sitting"],
  },
  {
    id: "education",
    category: "local-service",
    archetype: "long-form",
    strong: ["tutoring", "tutor", "academy", "montessori", "preschool", "curriculum"],
    medium: ["school", "students", "lessons", "courses", "enrollment", "bootcamp"],
    weak: ["learning", "teaching", "education"],
  },
  {
    id: "local-retail",
    category: "local-service",
    archetype: "storefront",
    strong: ["florist", "boutique", "hardware", "grocer", "grocery", "pharmacy", "bookstore"],
    medium: ["shop", "store", "storefront", "retail", "showroom", "gifts"],
    weak: ["gift", "inventory", "aisle"],
  },

  // ---- hospitality ---------------------------------------------------------
  {
    id: "restaurant",
    category: "hospitality",
    archetype: "storefront",
    strong: ["restaurant", "bistro", "trattoria", "steakhouse", "brasserie", "izakaya", "ramen", "taqueria"],
    medium: ["dining", "kitchen", "chef", "menu", "reservations", "tasting"],
    weak: ["food", "cuisine", "seasonal", "plates"],
  },
  {
    id: "cafe-bakery",
    category: "hospitality",
    archetype: "storefront",
    strong: ["bakery", "patisserie", "creamery", "roastery", "sourdough"],
    medium: ["cafe", "coffee", "espresso", "pastry", "pastries", "bakes", "brunch"],
    weak: ["artisan", "beans", "loaf"],
  },
  {
    id: "hotel-lodging",
    category: "hospitality",
    archetype: "booking",
    strong: ["hotel", "hostel", "resort", "airbnb", "guesthouse", "lodge", "chalet"],
    medium: ["inn", "rooms", "suites", "stay", "retreat", "villa"],
    weak: ["nights", "checkin", "hospitality"],
  },
  {
    id: "bar-nightlife",
    category: "hospitality",
    archetype: "storefront",
    strong: ["nightclub", "cocktail", "brewery", "taproom", "distillery", "winery", "speakeasy"],
    medium: ["bar", "pub", "lounge", "wines", "beers"],
    weak: ["drinks", "nightlife", "list"],
  },
  {
    id: "events-catering",
    category: "hospitality",
    archetype: "booking",
    strong: ["catering", "caterer", "banquet", "venue"],
    medium: ["events", "receptions", "buffet", "hosting"],
    weak: ["party", "guests", "celebration"],
  },
  {
    id: "travel-tours",
    category: "hospitality",
    archetype: "booking",
    strong: ["tours", "safari", "excursions", "itinerary", "trekking"],
    medium: ["travel", "guided", "expeditions", "cruises", "tourism"],
    weak: ["trips", "destinations", "adventure"],
  },

  // ---- professional --------------------------------------------------------
  {
    id: "legal",
    category: "professional",
    archetype: "long-form",
    strong: ["law", "attorney", "attorneys", "litigation", "solicitor", "barrister", "paralegal"],
    medium: ["legal", "counsel", "firm", "defense", "compliance", "arbitration"],
    weak: ["clients", "cases", "advice"],
  },
  {
    id: "finance",
    category: "professional",
    archetype: "long-form",
    strong: ["accounting", "accountant", "bookkeeping", "wealth", "taxation", "audit", "payroll"],
    medium: ["finance", "financial", "advisory", "capital", "portfolio", "investments", "tax"],
    weak: ["planning", "returns", "growth"],
  },
  {
    id: "consulting",
    category: "professional",
    archetype: "long-form",
    strong: ["consultancy", "consulting", "consultants", "advisory"],
    medium: ["strategy", "operations", "transformation", "b2b", "enterprise"],
    weak: ["clients", "workshops", "process"],
  },
  {
    id: "real-estate",
    category: "professional",
    archetype: "storefront",
    strong: ["realtor", "realty", "brokerage", "listings", "conveyancing"],
    medium: ["property", "properties", "estate", "leasing", "landlord", "mortgage"],
    weak: ["homes", "buyers", "sellers"],
  },
  {
    id: "insurance",
    category: "professional",
    archetype: "long-form",
    strong: ["insurance", "underwriting", "actuarial", "broker"],
    medium: ["policies", "coverage", "claims", "premiums"],
    weak: ["risk", "protection", "quote"],
  },
  {
    id: "saas-tech",
    category: "professional",
    archetype: "saas",
    strong: ["saas", "api", "platform", "dashboard", "devtools", "integrations"],
    medium: ["software", "product", "analytics", "workflow", "automation", "onboarding"],
    weak: ["teams", "data", "cloud"],
  },
  {
    id: "nonprofit",
    category: "professional",
    archetype: "long-form",
    strong: ["nonprofit", "charity", "ngo", "foundation", "philanthropy"],
    medium: ["donations", "donors", "volunteers", "mission", "fundraising"],
    weak: ["impact", "community", "programs"],
  },

  // ---- creative ------------------------------------------------------------
  {
    id: "design-studio",
    category: "creative",
    archetype: "portfolio",
    strong: ["typography", "identity", "branding", "artdirection"],
    medium: ["design", "designers", "brand", "creative"],
    weak: ["studio", "craft", "visual"],
  },
  {
    id: "photography",
    category: "creative",
    archetype: "portfolio",
    strong: ["photography", "photographer", "videography", "filmmaker", "cinematography"],
    medium: ["photo", "photos", "shoots", "lens", "editorial"],
    weak: ["images", "frames", "light"],
  },
  {
    id: "architecture",
    category: "creative",
    archetype: "portfolio",
    strong: ["architecture", "architects", "architect", "interiors", "landscape"],
    medium: ["atelier", "buildings", "spatial", "masterplan"],
    weak: ["residential", "projects", "materials"],
  },
  {
    id: "fashion",
    category: "creative",
    archetype: "storefront",
    strong: ["fashion", "couture", "apparel", "menswear", "womenswear", "jewellery", "jewelry"],
    medium: ["collection", "lookbook", "garments", "textiles", "label"],
    weak: ["pieces", "season", "wardrobe"],
  },
  {
    id: "agency-marketing",
    category: "creative",
    archetype: "long-form",
    strong: ["agency", "advertising", "seo", "copywriting"],
    medium: ["marketing", "campaigns", "growth", "media", "content"],
    weak: ["channels", "audience", "reach"],
  },
  {
    id: "wedding",
    category: "creative",
    archetype: "portfolio",
    strong: ["wedding", "weddings", "bridal", "elopement"],
    medium: ["ceremony", "florals", "engagement"],
    weak: ["couples", "celebration", "day"],
  },
] as const satisfies readonly IndustryDef[];

export const INDUSTRIES = INDUSTRY_DEFS.map((row) => row.id) as unknown as [Industry, ...Industry[]];

export type Industry = (typeof INDUSTRY_DEFS)[number]["id"];

const INDUSTRY_BY_ID = new Map<string, IndustryDef>(
  INDUSTRY_DEFS.map((row) => [row.id, row as unknown as IndustryDef])
);

interface ArchetypeDef {
  id: SiteArchetype;
  strong: string[];
  medium: string[];
}

const ARCHETYPE_DEFS: ArchetypeDef[] = [
  {
    id: "portfolio",
    strong: ["portfolio", "lookbook", "showreel", "casestudies"],
    medium: ["gallery", "works", "projects", "selected", "archive"],
  },
  {
    id: "storefront",
    strong: ["ecommerce", "checkout", "catalogue", "catalog"],
    medium: ["shop", "store", "menu", "products", "collection", "pricing"],
  },
  {
    id: "booking",
    strong: ["appointments", "scheduling", "reservations"],
    medium: ["booking", "slots", "availability", "consultation", "walkin"],
  },
  {
    id: "long-form",
    strong: ["whitepaper", "casestudy"],
    medium: ["blog", "insights", "articles", "guides", "resources", "faq"],
  },
  {
    id: "saas",
    strong: ["saas", "freetrial", "signup", "integrations"],
    medium: ["dashboard", "api", "plans", "onboarding", "workspace"],
  },
];

const WEIGHTS = { strong: 3, medium: 2, weak: 1 } as const;

/** Lowercased word set plus the normalized string, so multi-word keys can still be matched. */
interface Bag {
  words: Set<string>;
  text: string;
}

function toBag(input: string): Bag {
  const text = input.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return { words: new Set(text.split(" ").filter(Boolean)), text };
}

function hits(bag: Bag, terms: readonly string[]): number {
  let n = 0;
  for (const term of terms) {
    if (term.includes(" ") ? bag.text.includes(term) : bag.words.has(term)) n += 1;
  }
  return n;
}

function scoreIndustry(bag: Bag, def: IndustryDef): number {
  return (
    hits(bag, def.strong) * WEIGHTS.strong +
    hits(bag, def.medium) * WEIGHTS.medium +
    hits(bag, def.weak) * WEIGHTS.weak
  );
}

export interface TaxonomyMatch {
  industry: Industry;
  archetype: SiteArchetype;
  category: SkinCategory;
  /** 0–1. 0 means nothing matched and the result is the declared-order default. */
  confidence: number;
  industryScore: number;
  archetypeScore: number;
  /** Industries within striking distance of the winner, best first, winner included. */
  runnersUp: Industry[];
}

const DEFAULT_INDUSTRY = INDUSTRY_DEFS[0]!.id as Industry;

export function classifyTaxonomy(input: string): TaxonomyMatch {
  const bag = toBag(input);

  const ranked = INDUSTRY_DEFS.map((def) => ({
    id: def.id as Industry,
    score: scoreIndustry(bag, def as unknown as IndustryDef),
  })).sort((a, b) => b.score - a.score);

  const top = ranked[0]!;
  const second = ranked[1]?.score ?? 0;
  const industry = top.score > 0 ? top.id : DEFAULT_INDUSTRY;
  const def = INDUSTRY_BY_ID.get(industry)!;

  const archetypeRanked = ARCHETYPE_DEFS.map((row) => ({
    id: row.id,
    score: hits(bag, row.strong) * WEIGHTS.strong + hits(bag, row.medium) * WEIGHTS.medium,
  })).sort((a, b) => b.score - a.score);
  const archetypeTop = archetypeRanked[0]!;

  return {
    industry,
    archetype: archetypeTop.score > 0 ? archetypeTop.id : def.archetype,
    category: def.category,
    confidence: top.score > 0 ? top.score / (top.score + second) : 0,
    industryScore: top.score,
    archetypeScore: archetypeTop.score,
    runnersUp: ranked.filter((row) => row.score > 0 && row.score >= top.score * 0.6).map((row) => row.id),
  };
}

export function industryCategory(industry: string): SkinCategory {
  return INDUSTRY_BY_ID.get(industry)?.category ?? "local-service";
}

export function industryArchetype(industry: string): SiteArchetype {
  return INDUSTRY_BY_ID.get(industry)?.archetype ?? "long-form";
}

export function industriesForCategory(category: SkinCategory): Industry[] {
  return INDUSTRY_DEFS.filter((row) => row.category === category).map((row) => row.id as Industry);
}

export function isIndustry(value: unknown): value is Industry {
  return typeof value === "string" && INDUSTRY_BY_ID.has(value);
}

export function isArchetype(value: unknown): value is SiteArchetype {
  return typeof value === "string" && (SITE_ARCHETYPES as readonly string[]).includes(value);
}

/**
 * Ranking score for a skin against a classified brief. Higher is better; 0 means no taxonomy
 * overlap at all, in which case callers should fall back to the category ladder.
 */
export function taxonomyAffinity(
  skin: { industries?: readonly string[]; archetype?: string; categories: readonly string[] },
  match: TaxonomyMatch
): number {
  let score = 0;
  if (skin.industries?.includes(match.industry)) score += 6;
  else if (skin.industries?.some((row) => match.runnersUp.includes(row as Industry))) score += 3;
  if (skin.archetype === match.archetype) score += 2;
  if (skin.categories.includes(match.category)) score += 1;
  return score;
}
