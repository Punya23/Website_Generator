/**
 * `business-data.ts`'s `businessDataResolver` — the real `DataResolver` a caller supplying its own
 * listings/agent-roster/testimonials gets wired up for (`GenerateSiteOptions.businessData`). Closes
 * the "no real listings/roster/testimonial data source exists" gap `PLACEMENTS_SCHEMA.md` and
 * `docs/PLACEMENTS_ORCHESTRATION_PLAN.md` both flag — these tests are the proof a real feed actually
 * reaches `fill.ts`'s placements, matched the same way `demo-data.ts`'s own resolver already is.
 */
import { describe, expect, it } from "vitest";
import { businessDataResolver, type BusinessDataFeed } from "../src/templates/placements/business-data.js";
import type { ImagePlacement, TextPlacement } from "../src/templates/placements/schema.js";

function textPlacement(overrides: Partial<TextPlacement>): TextPlacement {
  return {
    id: "home.card.0.price",
    kind: "text",
    page: "test.html",
    selector: "#p1",
    tag: "span",
    section: "test",
    role: "propertyPrice",
    fillSource: "data",
    original: "$500,000",
    constraints: { minChars: 3, maxChars: 20, minWords: 1, maxWords: 6, maxLines: 1 },
    ...overrides,
  };
}

function imagePlacement(overrides: Partial<ImagePlacement>): ImagePlacement {
  return {
    id: "home.agents.0.photo",
    kind: "image",
    page: "test.html",
    selector: "#i1",
    domKind: "img",
    section: "test",
    role: "agentHeadshot",
    fillSource: "data",
    original: "https://example.com/original.jpg",
    constraints: { aspectRatio: "1:1", minWidthPx: 400, minHeightPx: 400 },
    subject: "a real agent headshot",
    ...overrides,
  };
}

const LISTING = {
  price: "$725,000",
  badge: "New",
  location: "Alameda, CA",
  title: "Harbor View Bungalow",
  beds: "3",
  baths: "2",
  sqft: "1,450",
  description: "A real listing.",
};

describe("businessDataResolver: listings", () => {
  it("resolves a property-card grid field by the placement id's own trailing suffix", async () => {
    const feed: BusinessDataFeed = { listings: [LISTING] };
    const resolve = businessDataResolver(feed);
    const price = await resolve(textPlacement({ id: "home.card.0.price", role: "propertyPrice" }));
    const beds = await resolve(textPlacement({ id: "home.card.0.beds", role: "propertyMeta" }));
    expect(price).toBe("$725,000");
    expect(beds).toBe("3");
  });

  it("cycles listings by card index so a multi-card grid doesn't repeat the same one", async () => {
    const second = { ...LISTING, price: "$899,000", title: "Second Listing" };
    const feed: BusinessDataFeed = { listings: [LISTING, second] };
    const resolve = businessDataResolver(feed);
    expect(await resolve(textPlacement({ id: "home.card.0.price", role: "propertyPrice" }))).toBe("$725,000");
    expect(await resolve(textPlacement({ id: "home.card.1.price", role: "propertyPrice" }))).toBe("$899,000");
    // Cycles via modulo rather than returning null past the end of the array.
    expect(await resolve(textPlacement({ id: "home.card.2.price", role: "propertyPrice" }))).toBe("$725,000");
  });

  it("resolves a single-listing detail-page role directly to the first listing", async () => {
    const feed: BusinessDataFeed = { listings: [LISTING] };
    const resolve = businessDataResolver(feed);
    expect(await resolve(textPlacement({ id: "detail.price", role: "detailPrice" }))).toBe("$725,000");
  });

  it("returns null (never a fabricated value) when nothing was supplied", async () => {
    const resolve = businessDataResolver({});
    expect(await resolve(textPlacement({ id: "home.card.0.price", role: "propertyPrice" }))).toBeNull();
  });

  it("returns null for a role this feed doesn't answer for, even with listings present", async () => {
    const feed: BusinessDataFeed = { listings: [LISTING] };
    const resolve = businessDataResolver(feed);
    expect(await resolve(textPlacement({ id: "home.hero.title", role: "sectionHeading", fillSource: "llm" }))).toBeNull();
  });
});

describe("businessDataResolver: agents", () => {
  it("resolves name/role/contact from a real agent roster, cycling by card index", async () => {
    const feed: BusinessDataFeed = {
      agents: [
        { name: "Priya Shah", role: "Senior Agent", contact: "(415) 555-0100 · priya@harborhomes.com" },
        { name: "Sam Lee" }, // no role supplied for Sam — the next assertion checks this falls through to null
      ],
    };
    const resolve = businessDataResolver(feed);
    expect(await resolve(textPlacement({ id: "agents.card.0.name", role: "agentName" }))).toBe("Priya Shah");
    expect(await resolve(textPlacement({ id: "agents.card.1.name", role: "agentName" }))).toBe("Sam Lee");
    expect(await resolve(textPlacement({ id: "agents.card.0.role", role: "agentRole" }))).toBe("Senior Agent");
    expect(await resolve(textPlacement({ id: "agents.card.1.role", role: "agentRole" }))).toBeNull(); // not supplied for Sam
  });

  it("resolves a real agent headshot URL for agentHeadshot/sidebarAgentPhoto image placements", async () => {
    const feed: BusinessDataFeed = { agents: [{ name: "Priya Shah", photoUrl: "https://cdn.example.com/priya.jpg" }] };
    const resolve = businessDataResolver(feed);
    expect(await resolve(imagePlacement({ id: "agents.card.0.photo", role: "agentHeadshot" }))).toBe(
      "https://cdn.example.com/priya.jpg"
    );
    expect(await resolve(imagePlacement({ id: "contact.sidebar.photo", role: "sidebarAgentPhoto" }))).toBe(
      "https://cdn.example.com/priya.jpg"
    );
  });

  it("never resolves a testimonial avatar from the agent roster", async () => {
    const feed: BusinessDataFeed = { agents: [{ name: "Priya Shah", photoUrl: "https://cdn.example.com/priya.jpg" }] };
    const resolve = businessDataResolver(feed);
    expect(await resolve(imagePlacement({ id: "home.testimonials.0.avatar", role: "testimonialAvatar" }))).toBeNull();
  });
});

describe("businessDataResolver: testimonials", () => {
  it("resolves a real customer quote/author, cycling by card index", async () => {
    const feed: BusinessDataFeed = {
      testimonials: [
        { quote: "They found us our dream home in two weeks.", authorName: "The Patels", authorRole: "Homebuyers" },
      ],
    };
    const resolve = businessDataResolver(feed);
    expect(await resolve(textPlacement({ id: "home.testimonials.0.quote", role: "testimonialQuote" }))).toBe(
      "They found us our dream home in two weeks."
    );
    expect(await resolve(textPlacement({ id: "home.testimonials.0.authorName", role: "testimonialAuthorName" }))).toBe(
      "The Patels"
    );
  });

  it("resolves a real testimonial avatar photo", async () => {
    const feed: BusinessDataFeed = { testimonials: [{ quote: "Great!", authorName: "A. Customer", photoUrl: "https://cdn.example.com/customer.jpg" }] };
    const resolve = businessDataResolver(feed);
    expect(await resolve(imagePlacement({ id: "home.testimonials.0.avatar", role: "testimonialAvatar" }))).toBe(
      "https://cdn.example.com/customer.jpg"
    );
  });
});
