/**
 * Phase 3 (docs/PLACEMENTS_ORCHESTRATION_PLAN.md): a demo `resolveData` for the curated real-estate
 * path. Before this, a `data`-fillSource listing field with no real value had exactly one fallback —
 * `illustrativeFill`, a plausible LLM-invented example — because nothing ever supplied `fill.ts`'s
 * own `resolveData` hook. That was never meant to be the only option: `applyPlacements`'s resolution
 * order (`resolveData` first, `illustrativeFill` second, see `fill.ts`) has always assumed a caller
 * could hand it REAL-ish listing data when it has some. This is that data, for a demo run or test
 * that wants a consistent, presentable set of listings instead of a fresh LLM guess every time.
 *
 * Scope: PROPERTY/LISTING facts only — price, location, badge, title, beds/baths/sqft (the property
 * card grid's fields; `description` rides along in the fixture for whichever future placement needs
 * it, see `DETAIL_ROLE_TO_FIELD`'s own comment). Deliberately does NOT answer for agent identity
 * (name/role/contact) or testimonials:
 * those stay on the illustrative-fill path exactly as today. A fixed English demo name shipped here
 * would win over `resolveData`'s already-locale-aware LLM naming (see `fill-real-estate-template.ts`'s
 * `PEOPLE_ROLES` and the "India tone" product decision it documents) regardless of the brief's own
 * locale — this resolver only ever returns non-null for the roles listed in `FIELD_BY_SUFFIX` /
 * `DETAIL_ROLE_TO_FIELD` below, so every other `data` placement falls through to `illustrativeFill`
 * completely unaffected.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DataResolver } from "./fill.js";
import type { Locale } from "./fill-real-estate-template.js";

export interface DemoListing {
  price: string;
  badge: string;
  location: string;
  title: string;
  beds: string;
  baths: string;
  sqft: string;
  description: string;
}

interface DemoListingsFixture {
  us: DemoListing[];
  india: DemoListing[];
}

let cached: DemoListingsFixture | null = null;

async function loadFixture(): Promise<DemoListingsFixture> {
  if (cached) return cached;
  const raw = await fs.readFile(path.resolve(process.cwd(), "fixtures/demo-listings.json"), "utf8");
  cached = JSON.parse(raw) as DemoListingsFixture;
  return cached;
}

/** Only exported so a test can force a re-read after swapping the fixture file on disk — normal
 *  callers never need this, the module-level cache is what production code should rely on. */
export function _resetDemoListingsCache(): void {
  cached = null;
}

/** Property-card grid roles (`real-estate-map.ts`'s `propertyCardDescriptors`) share one generic
 *  `role` for beds/baths/sqft (`"propertyMeta"`) — only the placement id's own trailing segment
 *  (`.beds`, `.baths`, `.sqft`) tells them apart, so this is matched against the id, not the role.
 *  Exported so `business-data.ts`'s real-listing resolver matches placements the identical way,
 *  instead of a second, driftable copy of the same suffix table. */
export const FIELD_BY_SUFFIX: Record<string, keyof DemoListing> = {
  price: "price",
  badge: "badge",
  location: "location",
  title: "title",
  beds: "beds",
  baths: "baths",
  sqft: "sqft",
};

export const CARD_ROLES = new Set(["propertyPrice", "propertyBadge", "propertyLocation", "propertyTitle", "propertyMeta"]);

/** `property-detail.html`'s own roles (one listing per page, not a grid) map directly, one role to
 *  one `DemoListing` field. Real-estate-map.ts's `property.description.body` is `fillSource: "llm"`,
 *  not `"data"` — there is no detail-page description role for this resolver to answer, so
 *  `DemoListing.description` is currently unused; kept on the type for whichever future placement
 *  (or template) does add one, rather than removed and re-added later. */
export const DETAIL_ROLE_TO_FIELD: Record<string, keyof DemoListing> = {
  detailPrice: "price",
  detailBadge: "badge",
  detailLocation: "location",
  detailTitle: "title",
};

/** Picks a listing deterministically from a placement's own id — the same id always gets the same
 *  listing (stable across a re-run), and a different listing per card index (`.0.`, `.1.`, ...) so a
 *  six-card grid doesn't show the same price six times. Cycles via modulo, so this works unmodified
 *  regardless of a page's own card count (3, 6, or 9 — see `real-estate-map.ts`'s per-page loops).
 *  Exported: nothing about the regex/modulo is listing-specific, and `business-data.ts` reuses it
 *  unchanged to cycle through a real agent roster or testimonial list the same way. */
export function listingIndexFor(id: string, count: number): number {
  const match = id.match(/\.(\d+)\.[^.]+$/);
  const n = match ? Number(match[1]) : 0;
  return count > 0 ? n % count : 0;
}

/**
 * Builds a `DataResolver` backed by `fixtures/demo-listings.json`. Picks the US or India fixture set
 * using the SAME locale signal `resolveLocale` already derives from the raw brief (`currencyLabel`)
 * — a Pune brokerage demo gets ₹ listing prices and Pune localities, not incongruous $ ones, with no
 * new locale-detection logic of its own.
 */
export function demoListingsResolver(locale: Locale): DataResolver {
  return async (placement) => {
    if (placement.kind !== "text") return null;

    const fixture = await loadFixture();
    const set = locale.currencyLabel.includes("Rupees") ? fixture.india : fixture.us;
    if (set.length === 0) return null;

    if (CARD_ROLES.has(placement.role)) {
      const suffix = placement.id.match(/\.([^.]+)$/)?.[1] ?? "";
      const field = FIELD_BY_SUFFIX[suffix];
      if (!field) return null;
      return set[listingIndexFor(placement.id, set.length)]![field];
    }

    const detailField = DETAIL_ROLE_TO_FIELD[placement.role];
    return detailField ? set[0]![detailField] : null;
  };
}
