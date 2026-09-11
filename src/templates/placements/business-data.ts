/**
 * A real `DataResolver` backed by data the business itself supplied — closes the gap
 * `PLACEMENTS_SCHEMA.md` (real-estate/) and `docs/PLACEMENTS_ORCHESTRATION_PLAN.md` both flag as
 * open: "no real listings/roster/testimonial data source exists in this codebase yet." That was
 * never really "no data source can exist" — `fill.ts`'s `resolveData` hook and `applyPlacements`'s
 * whole resolution order (`resolveData` first, `illustrativeFill` second, never invented as "real")
 * were already built to take one. What was missing was a caller-facing shape for "here is the real
 * data" and a resolver that answers `fill.ts`'s placements from it — this file, plus
 * `GenerateSiteOptions.businessData` (`orchestrator.ts`) threading it down to both the curated
 * (`placements-pipeline.ts`) and corpus (`placements-corpus-fill.ts`) paths.
 *
 * Deliberately NOT an integration with any specific external MLS/CRM/listings API — no such system
 * exists in or is named by this codebase. This is the generic plumbing: whoever calls `generateSite`
 * (a real orchestrator, a script, a test) fetches the business's own real records however it already
 * does that, shapes them into a `BusinessDataFeed`, and passes it in. A field this feed doesn't cover
 * for a given business (no real testimonials yet, say) simply resolves to `null` here, exactly like
 * an empty feed — `applyPlacements` then falls through to `illustrativeFill` (a plausible, clearly-
 * labeled-as-example value), never to a demo fixture. `demo-data.ts`'s `demoListingsResolver` stays
 * a separate, deliberately-demo-only resolver (the CLI's `DEMO_LISTINGS=1`) — chaining it in here as
 * a silent fallback would put canned fictional content ("Jennifer Lawson, Palo Alto") into a REAL
 * generated site whenever a business's real feed was merely incomplete, which is a worse outcome
 * than the honest "no real record yet" `illustrativeFill` already produces.
 */
import type { DataResolver } from "./fill.js";
import type { DemoListing } from "./demo-data.js";
import { CARD_ROLES, DETAIL_ROLE_TO_FIELD, FIELD_BY_SUFFIX, listingIndexFor } from "./demo-data.js";

/** A real listing is shaped identically to the demo fixture's own `DemoListing` — a listing is a
 *  listing, real or demo; no separate type needed. */
export type RealListing = DemoListing;

export interface RealAgent {
  name: string;
  role?: string;
  /** Phone/email/license in one line, matching `agentContact`'s own template shape — see
   *  `real-estate-map.ts`'s `agentContact` notes. Omitted, that placement keeps the template's own
   *  demo contact (brand-swapped only), same as today. */
  contact?: string;
  photoUrl?: string;
}

export interface RealTestimonial {
  quote: string;
  authorName: string;
  authorRole?: string;
  photoUrl?: string;
}

export interface BusinessDataFeed {
  listings?: RealListing[];
  agents?: RealAgent[];
  testimonials?: RealTestimonial[];
}

const AGENT_FIELD_BY_ROLE: Partial<Record<string, keyof RealAgent>> = {
  agentName: "name",
  agentRole: "role",
  agentContact: "contact",
};

const TESTIMONIAL_FIELD_BY_ROLE: Partial<Record<string, keyof RealTestimonial>> = {
  testimonialQuote: "quote",
  testimonialAuthorName: "authorName",
  testimonialAuthorRole: "authorRole",
};

const AGENT_PHOTO_ROLES = new Set(["agentHeadshot", "sidebarAgentPhoto"]);

/**
 * Builds a `DataResolver` over one business's own real listings/agents/testimonials. Matching
 * mirrors `demoListingsResolver`'s own approach exactly (role, or the id's own trailing suffix for
 * the property-card grid's shared `"propertyMeta"` role) so the two resolvers are interchangeable
 * from `fill.ts`'s point of view — only where the data comes from differs.
 *
 * Returns `null` — never a fabricated value — for any placement this feed has nothing for, whether
 * because the whole category (e.g. `agents`) was never supplied or just doesn't cover this specific
 * slot (a 6-card grid with only 4 real listings on file: indices 4 and 5 come back `null`, not a
 * repeat dressed up as a different listing). The caller's own `illustrativeFill` decides what (if
 * anything) fills the gap from there — this function's only job is "do we have a real answer".
 */
export function businessDataResolver(feed: BusinessDataFeed): DataResolver {
  return async (placement) => {
    if (placement.kind === "image") {
      if (AGENT_PHOTO_ROLES.has(placement.role) && feed.agents?.length) {
        return feed.agents[listingIndexFor(placement.id, feed.agents.length)]!.photoUrl ?? null;
      }
      if (placement.role === "testimonialAvatar" && feed.testimonials?.length) {
        return feed.testimonials[listingIndexFor(placement.id, feed.testimonials.length)]!.photoUrl ?? null;
      }
      return null;
    }

    if (feed.listings?.length) {
      if (CARD_ROLES.has(placement.role)) {
        const suffix = placement.id.match(/\.([^.]+)$/)?.[1] ?? "";
        const field = FIELD_BY_SUFFIX[suffix];
        if (field) return feed.listings[listingIndexFor(placement.id, feed.listings.length)]![field];
      }
      const detailField = DETAIL_ROLE_TO_FIELD[placement.role];
      if (detailField) return feed.listings[0]![detailField];
    }

    if (feed.agents?.length) {
      const agentField = AGENT_FIELD_BY_ROLE[placement.role];
      if (agentField) {
        const value = feed.agents[listingIndexFor(placement.id, feed.agents.length)]![agentField];
        if (value) return value;
      }
    }

    if (feed.testimonials?.length) {
      const testimonialField = TESTIMONIAL_FIELD_BY_ROLE[placement.role];
      if (testimonialField) {
        const value = feed.testimonials[listingIndexFor(placement.id, feed.testimonials.length)]![testimonialField];
        if (value) return value;
      }
    }

    return null;
  };
}
