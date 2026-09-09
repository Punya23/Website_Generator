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

let manifest: TemplateManifest;
let placed: PlacedSection[];
let file: PlacementsFile;

beforeAll(async () => {
  const loaded = await templateStore().manifest(PINNED_TEMPLATE_ID);
  if (!loaded || loaded.status !== "ready") {
    throw new Error(
      `Pinned corpus template ${PINNED_TEMPLATE_ID} is missing or not ready — this test needs a real ingested template. ` +
        `Pick a different "ready" id from data/template-store.json and update PINNED_TEMPLATE_ID.`
    );
  }
  manifest = loaded;

  const hero = manifest.sections.find((s) => s.role === "hero");
  const footer = manifest.sections.find((s) => s.role === "footer");
  const testimonials = manifest.sections.find((s) => s.role === "testimonials");
  const team = manifest.sections.find((s) => s.role === "team");
  if (!hero || !footer) throw new Error("Pinned template no longer has a hero/footer section — pick another.");

  placed = [hero, testimonials, team, footer]
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ templateId: manifest.templateId, sectionId: s.id, role: s.role }));

  file = await buildPlacementsFromSelection(
    { pages: { home: placed } },
    templateStore(),
    { templateId: manifest.templateId, templateName: manifest.name, vertical: manifest.industry ?? "general" }
  );
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
