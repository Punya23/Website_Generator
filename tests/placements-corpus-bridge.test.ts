/**
 * Proves the answer to "is the engine generic, or only wired to real-estate": builds a
 * `PlacementsFile` from a REAL, already-ingested corpus template (auto-discovered slots — nothing
 * hand-mapped) and runs it through the exact same `llm-view.ts` / `fill.ts` used for the real-estate
 * templates, unmodified. If this passes, the engine (not the map) is confirmed category-agnostic.
 *
 * Uses whatever `status: "ready"` template in `data/template-cache/` has the richest section
 * coverage (hero + footer + testimonials/team, real slots and photo slots) — found once and pinned
 * below rather than re-scanned every run, so this test doesn't silently start testing something
 * thinner if the corpus changes. If that template ever stops existing, `beforeAll` fails loudly
 * with a clear message instead of the individual tests failing confusingly.
 *
 * TWO templates are pinned, not one, because the two halves of the people policy need different
 * shapes to be exercised at all: the first template's team/testimonials sections carry text slots
 * but ZERO photo slots, so on its own it silently proves nothing about people PHOTOS (806 of the
 * corpus's 2574 people sections do carry them, 4230 photo slots in total). The second is pinned
 * specifically for having photo slots in both, so `imagePlacementFromPhotoSlot`'s guard is real.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { templateStore } from "../src/templates/store.js";
import { templateCachePath } from "../src/templates/ingest/ingest-template.js";
import type { PlacedSection, TemplateManifest } from "../src/templates/types.js";
import { buildPlacementsFromSelection } from "../src/templates/placements/from-corpus.js";
import { applyFlatLlmResponse, buildFlatPromptPayload, buildLlmView } from "../src/templates/placements/llm-view.js";
import { applyPlacements } from "../src/templates/placements/fill.js";
import type { PlacementsFile } from "../src/templates/placements/schema.js";

const PINNED_TEMPLATE_ID = "tpl_0050107a0d3b"; // "Rakar Multipurpose Services" — hero/testimonials/team/footer, 227 slots, 94 photo slots
/** Pinned for the one property the template above happens NOT to have: its first team section
 *  (4 photo slots) and its first testimonials section (1) both contain faces, so the people-photo
 *  half of the policy is actually executed rather than vacuously skipped. */
const PINNED_PEOPLE_PHOTO_TEMPLATE_ID = "tpl_d752e58a05b5"; // "Lawgist Attorney Lawyers" — team 4 photo slots / 9 slots, testimonials 1 / 4

let manifest: TemplateManifest;
let placed: PlacedSection[];
let file: PlacementsFile;
let peopleManifest: TemplateManifest;
let peopleFile: PlacementsFile;

/** Loads one pinned id and builds a `PlacementsFile` from hero + testimonials + team + footer —
 *  the same four roles for both pinned templates, so the two differ only in what the corpus
 *  auto-discovered inside them. */
async function loadPinned(templateId: string): Promise<{ manifest: TemplateManifest; placed: PlacedSection[]; file: PlacementsFile }> {
  const loaded = await templateStore().manifest(templateId);
  if (!loaded || loaded.status !== "ready") {
    throw new Error(
      `Pinned corpus template ${templateId} is missing or not ready — this test needs a real ingested template. ` +
        `Pick a different "ready" id from data/template-store.json and update the pinned constant.`
    );
  }

  const hero = loaded.sections.find((s) => s.role === "hero");
  const footer = loaded.sections.find((s) => s.role === "footer");
  const testimonials = loaded.sections.find((s) => s.role === "testimonials");
  const team = loaded.sections.find((s) => s.role === "team");
  if (!hero || !footer) throw new Error(`Pinned template ${templateId} no longer has a hero/footer section — pick another.`);

  const sections = [hero, testimonials, team, footer]
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ templateId: loaded.templateId, sectionId: s.id, role: s.role }));

  return {
    manifest: loaded,
    placed: sections,
    file: await buildPlacementsFromSelection(
      { pages: { home: sections } },
      templateStore(),
      { templateId: loaded.templateId, templateName: loaded.name, vertical: loaded.industry ?? "general" }
    ),
  };
}

beforeAll(async () => {
  ({ manifest, placed, file } = await loadPinned(PINNED_TEMPLATE_ID));
  ({ manifest: peopleManifest, file: peopleFile } = await loadPinned(PINNED_PEOPLE_PHOTO_TEMPLATE_ID));

  // The second pin exists ONLY for its people photo slots — if a re-ingest ever drops them, say so
  // here rather than letting the policy tests below pass by testing nothing.
  const withPhotos = peopleManifest.sections.filter(
    (s) => (s.role === "team" || s.role === "testimonials") && s.photoSlots.length > 0
  );
  if (withPhotos.length === 0) {
    throw new Error(
      `Pinned template ${PINNED_PEOPLE_PHOTO_TEMPLATE_ID} no longer has photo slots in a team/testimonials section — ` +
        `re-scan data/template-cache/ for a "ready" template that does and update PINNED_PEOPLE_PHOTO_TEMPLATE_ID.`
    );
  }
});

describe("from-corpus: auto-discovered slots feed the same engine as the hand-mapped templates", () => {
  it("produces a schema-valid PlacementsFile from real, auto-discovered slots — no hand-authored selector involved", () => {
    expect(file.pages.home).toBeDefined();
    expect(file.pages.home!.text.length).toBeGreaterThan(0);
  });

  it("forces every slot inside a testimonials/team section to fixed, regardless of its slot kind", () => {
    const testimonialsSection = manifest.sections.find((s) => s.role === "testimonials");
    if (!testimonialsSection || testimonialsSection.slots.length === 0) return; // this template may not have one — other assertions still cover the policy
    const ids = file.pages.home!.text.filter((t) => t.section.endsWith(`:${testimonialsSection.id}`));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((t) => t.fillSource === "fixed")).toBe(true);
  });

  it("maps businessName/phone/email slots to brief, and heading/tagline slots to llm", () => {
    const heroSection = manifest.sections.find((s) => s.role === "hero")!;
    const heroPlacements = file.pages.home!.text.filter((t) => t.section.endsWith(`:${heroSection.id}`));
    for (const kind of ["businessName", "phone", "email"] as const) {
      const match = heroPlacements.find((t) => t.role === kind);
      if (match) expect(match.fillSource).toBe("brief");
    }
    for (const kind of ["tagline", "sectionHeading", "sectionBody"] as const) {
      const match = heroPlacements.find((t) => t.role === kind);
      if (match) expect(match.fillSource).toBe("llm");
    }
  });

  it("never sets a constraint ceiling below the length of the text already shipping there", () => {
    for (const t of file.pages.home!.text) {
      expect(t.constraints.maxChars).toBeGreaterThanOrEqual(t.original.trim().length);
    }
  });

  it("round-trips through the SAME llm-view.ts used for real-estate — nav-shaped locked content excluded from the prompt", () => {
    const view = buildLlmView(file);
    const prompt = buildFlatPromptPayload(view.pages.home!);
    const testimonialsSection = manifest.sections.find((s) => s.role === "testimonials");
    if (testimonialsSection) {
      const leaked = Object.keys(prompt).some((id) => id.includes(`:${testimonialsSection.id}.`));
      expect(leaked).toBe(false);
    }
    expect(Object.keys(prompt).length).toBeGreaterThan(0);
  });

  it("fill.ts (unmodified) writes a real LLM-style value into the REAL cached section HTML, respecting its auto-derived constraints", async () => {
    const heroSection = manifest.sections.find((s) => s.role === "hero")!;
    const heroTagline = file.pages.home!.text.find((t) => t.section.endsWith(`:${heroSection.id}`) && t.role === "tagline");
    if (!heroTagline) return; // this template's hero may not have located a tagline slot — other tests still cover the pipeline

    const html = await fs.readFile(path.join(templateCachePath(heroSection.templateId), heroSection.htmlCachePath), "utf8");
    const tooLong = "This is a deliberately way too long headline that should be truncated automatically by the constraint engine rather than corrupting the layout of this real scraped template section.";

    const result = await applyPlacements(
      html,
      { page: "home", text: [heroTagline], images: [] },
      { brief: { businessName: "Test Co" }, llmValues: { [heroTagline.id]: tooLong } }
    );

    expect(result.appliedText).toBe(1);
    expect(result.clamped.length).toBe(1);
    expect(result.clamped[0]!.reason).toContain("truncated");
  });
});

/**
 * The photo half of the same "no fabricated people" policy the text tests above cover. Pinned on a
 * SECOND template because the first one's people sections have no photo slots at all — every
 * assertion here would pass vacuously on it while a headshot elsewhere in the corpus was quietly
 * being swapped for a stock-photo search result.
 */
describe("from-corpus: a photo inside a team/testimonials section is never an llmQuery", () => {
  /** Every image placement built from a people section, keyed off the manifest rather than the
   *  placement's `role` string, so a change to how `role` is spelled can't hide a regression. */
  function peopleImages() {
    const peopleSectionIds = new Set(
      peopleManifest.sections.filter((s) => s.role === "team" || s.role === "testimonials").map((s) => s.id)
    );
    return peopleFile.pages.home!.images.filter((img) =>
      [...peopleSectionIds].some((id) => img.section.endsWith(`:${id}`))
    );
  }

  it("actually has people photo placements to judge — the gap that made this second pin necessary", () => {
    expect(peopleImages().length).toBeGreaterThan(0);
  });

  it("marks them data (resolvable only from the business's own feed), never llmQuery", () => {
    for (const img of peopleImages()) expect(img.fillSource).toBe("data");
  });

  it("still marks non-people photos on the SAME template llmQuery — the guard is scoped, not a blanket lockdown", () => {
    const peopleIds = new Set(peopleImages().map((img) => img.id));
    const others = peopleFile.pages.home!.images.filter((img) => !peopleIds.has(img.id));
    if (others.length === 0) return; // hero/footer may carry no photo slots — the scoping is covered by the text tests too
    expect(others.some((img) => img.fillSource === "llmQuery")).toBe(true);
  });

  it("hides them from the model's prompt, so no stock-photo query can be requested for a face", () => {
    const view = buildLlmView(peopleFile);
    const ids = new Set(peopleImages().map((img) => img.id));
    const fields = Object.values(view.pages.home!.sections)
      // A photo slot indexed `.photo.0`/`.photo.1` lands in `instances`, a lone one in `fields` —
      // walk both so the assertion doesn't depend on which shape this template happened to produce.
      .flatMap((section) => [...Object.values(section.fields ?? {}), ...(section.instances ?? []).flatMap((i) => Object.values(i))])
      .filter((field) => ids.has(field.id));
    expect(fields.length).toBe(ids.size);
    expect(fields.every((field) => field.editable === false)).toBe(true);

    // And a model that returns one anyway (id guessed, or echoed from an older prompt) is dropped
    // rather than trusted — the same rejection path `fill.ts` backstops for locked text.
    const smuggled = Object.fromEntries([...ids].map((id) => [id, "smiling professional headshot"]));
    expect(applyFlatLlmResponse(view, { values: smuggled })).toEqual({});
  });

  it("fill.ts leaves the template's own demo photo in place when no real feed resolves it", async () => {
    const target = peopleImages()[0]!;
    const section = peopleManifest.sections.find((s) => target.section.endsWith(`:${s.id}`))!;
    const html = await fs.readFile(path.join(templateCachePath(section.templateId), section.htmlCachePath), "utf8");

    const result = await applyPlacements(
      html,
      { page: "home", text: [], images: [target] },
      // No `resolveData`: the real-world case of a business that hasn't supplied staff photos.
      { brief: { businessName: "Test Co" } }
    );

    expect(result.appliedImages).toBe(0);
    expect(result.html).toBe(html);
  });
});
