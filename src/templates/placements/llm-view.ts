/**
 * The LLM-facing view of a `PlacementsFile`: nested by page → section → field, with `editable`
 * decided per field instead of left for a human to infer from a `fillSource` enum. This is what
 * answers "the nav section never needs anything, the hero section needs 5 things" directly — the
 * question this whole pipeline exists to make easy to answer without reading markup.
 *
 * Three functions, one round trip:
 *   buildLlmView(file)              -> the full, reviewable map (editable AND locked fields, with
 *                                       a `reason` on every locked one) — this is what gets saved
 *                                       as `placements.llm.json`, attached to the template.
 *   buildPromptPayload(view)        -> strips that down to ONLY editable fields, with none of the
 *                                       internal bookkeeping (`id`, `editable`, `reason`) — this,
 *                                       and only this, is what actually gets sent to an LLM.
 *   applyLlmResponse(view, answer)  -> takes the model's answer back in the SAME nested shape and
 *                                       resolves every value to its real placement id, ready to
 *                                       hand straight to `fill.ts`'s `applyPlacements` as
 *                                       `llmValues`. A value for a field the reference view marks
 *                                       non-editable is silently dropped here too — the second of
 *                                       two independent places (the other is `fill.ts` itself) that
 *                                       refuse to let a locked field be overwritten.
 */
import type { ImagePlacement, PagePlacements, PlacementsFile, TextPlacement } from "./schema.js";

/** Everything after the last `.` in a placement id — `"home.hero.title"` -> `"title"`,
 *  `"property.facts.0.value"` -> `"value"`. A handful of repeated single-field groups (nav links,
 *  footer link lists, amenity bullets) end in a bare index with no field word after it
 *  (`"chrome.nav.link.3"`) — those collapse to the generic key `"text"` since there is only ever
 *  one field per instance to name. */
function fieldKeyFor(id: string): string {
  const last = id.split(".").pop() ?? "value";
  return /^\d+$/.test(last) ? "text" : last;
}

/** The `N` in a `.N.` (or trailing `.N`) segment of an id — which instance of a repeated section
 *  (which property card, which nav link, which FAQ item) this placement belongs to. `undefined`
 *  for a singular, non-repeated placement (a section's own heading, the hero title). */
function instanceIndexFor(id: string): number | undefined {
  const match = id.match(/\.(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : undefined;
}

export interface LlmField {
  /** The real placement id this resolves to — internal bookkeeping, stripped out by
   *  `buildPromptPayload` before anything reaches a model. */
  id: string;
  type: "text" | "image";
  editable: boolean;
  /** The template's own current value — a length/style reference for an editable field, or simply
   *  what's already there for a locked one. */
  current: string;
  minChars?: number;
  maxChars?: number;
  aspectRatio?: string;
  minWidthPx?: number;
  minHeightPx?: number;
  subject?: string;
  /** Why this field is locked — set only when `editable` is false. */
  reason?: string;
}

export interface LlmSection {
  /** This section's own singular fields (a heading, a subtitle) — absent for a section that is
   *  purely a repeated list. */
  fields?: Record<string, LlmField>;
  /** One entry per repeated instance (each property card, each nav link, each FAQ item), same
   *  field-key shape as `fields`. Absent for a section with no repetition. */
  instances?: Array<Record<string, LlmField>>;
}

export interface LlmPageView {
  sections: Record<string, LlmSection>;
}

export interface LlmTemplateView {
  template: string;
  pages: Record<string, LlmPageView>;
}

function reasonFor(fillSource: string): string {
  switch (fillSource) {
    case "fixed":
      return "structural/UI text — never rewritten";
    case "brief":
      return "comes from the business's own profile, not the model";
    case "data":
      return "a specific real fact (price, address, identity, a genuine testimonial) — comes from the business's own data, never invented";
    default:
      return "not editable by the model";
  }
}

function textField(p: TextPlacement): LlmField {
  const editable = p.fillSource === "llm";
  const field: LlmField = { id: p.id, type: "text", editable, current: p.original };
  if (editable) {
    field.minChars = p.constraints.minChars;
    field.maxChars = p.constraints.maxChars;
  } else {
    field.reason = reasonFor(p.fillSource);
  }
  return field;
}

function imageField(p: ImagePlacement): LlmField {
  const editable = p.fillSource === "llmQuery";
  const field: LlmField = { id: p.id, type: "image", editable, current: p.original };
  if (editable) {
    field.aspectRatio = p.constraints.aspectRatio;
    field.minWidthPx = p.constraints.minWidthPx;
    field.minHeightPx = p.constraints.minHeightPx;
    field.subject = p.subject;
  } else {
    field.reason = reasonFor(p.fillSource);
  }
  return field;
}

function place(sections: Record<string, LlmSection>, section: string, id: string, field: LlmField): void {
  const bucket = (sections[section] ??= {});
  const key = fieldKeyFor(id);
  const index = instanceIndexFor(id);
  if (index === undefined) {
    (bucket.fields ??= {})[key] = field;
  } else {
    const instances = (bucket.instances ??= []);
    (instances[index] ??= {})[key] = field;
  }
}

function buildPage(pageSet: PagePlacements): LlmPageView {
  const sections: Record<string, LlmSection> = {};
  for (const p of pageSet.text) place(sections, p.section, p.id, textField(p));
  for (const p of pageSet.images) place(sections, p.section, p.id, imageField(p));
  return { sections };
}

/** The full map: every section, every field, `editable` true/false on each one. Saved as
 *  `placements.llm.json` — the artifact meant to be attached to the template and reviewed, not
 *  regenerated silently as a side effect of something else. */
export function buildLlmView(file: PlacementsFile): LlmTemplateView {
  const pages: Record<string, LlmPageView> = {};
  for (const pageKey of ["chrome", ...file.pageOrder]) {
    const pageSet = file.pages[pageKey];
    if (pageSet) pages[pageKey] = buildPage(pageSet);
  }
  return { template: file.templateId, pages };
}

export interface PromptField {
  type: "text" | "image";
  current: string;
  minChars?: number;
  maxChars?: number;
  aspectRatio?: string;
  minWidthPx?: number;
  minHeightPx?: number;
  subject?: string;
}
export interface PromptSection {
  fields?: Record<string, PromptField>;
  instances?: Array<Record<string, PromptField>>;
}
export interface PromptPayload {
  template: string;
  pages: Record<string, { sections: Record<string, PromptSection> }>;
}

function toPromptField(field: LlmField): PromptField {
  const { id: _id, editable: _editable, reason: _reason, ...rest } = field;
  return rest;
}

/**
 * Strips `buildLlmView`'s output down to exactly what a model should see: only editable fields,
 * none of the orchestration's own bookkeeping. Sections and pages with nothing editable at all are
 * dropped entirely — a section like `"nav"` never appears in this payload, which is the literal
 * answer to "does the nav ever need to change" (no, it isn't even here to ask about).
 *
 * A repeated section keeps one entry per instance even when a given instance has nothing editable
 * in it (an empty `{}`), so `applyLlmResponse` can still line up the model's answer by position.
 */
export function buildPromptPayload(view: LlmTemplateView): PromptPayload {
  const pages: PromptPayload["pages"] = {};
  for (const [pageKey, page] of Object.entries(view.pages)) {
    const sections: Record<string, PromptSection> = {};
    for (const [sectionKey, section] of Object.entries(page.sections)) {
      const promptSection: PromptSection = {};

      if (section.fields) {
        const editable = Object.entries(section.fields).filter(([, f]) => f.editable);
        if (editable.length > 0) {
          promptSection.fields = Object.fromEntries(editable.map(([key, f]) => [key, toPromptField(f)]));
        }
      }
      if (section.instances) {
        const instances = section.instances.map((instance) => {
          const editable = Object.entries(instance).filter(([, f]) => f.editable);
          return Object.fromEntries(editable.map(([key, f]) => [key, toPromptField(f)]));
        });
        if (instances.some((instance) => Object.keys(instance).length > 0)) promptSection.instances = instances;
      }

      if (promptSection.fields || promptSection.instances) sections[sectionKey] = promptSection;
    }
    if (Object.keys(sections).length > 0) pages[pageKey] = { sections };
  }
  return { template: view.template, pages };
}

/**
 * Resolves a model's answer (same nested `{pages:{[page]:{sections:{[section]:{fields,instances}}}}}`
 * shape `buildPromptPayload` sent, values as plain strings) back to `Record<placementId, string>` —
 * ready to pass straight into `fill.ts`'s `applyPlacements` as `llmValues`.
 *
 * Never throws on a malformed or partial response: an unrecognized page/section/field/instance is
 * simply skipped, and a value offered for a field `view` marks non-editable is silently dropped —
 * `fill.ts` also refuses a `fixed` placement on its own, so this is defense in depth, not the only
 * gate.
 */
export function applyLlmResponse(view: LlmTemplateView, response: unknown): Record<string, string> {
  const values: Record<string, string> = {};
  const pages = isRecord(response) && isRecord(response.pages) ? response.pages : undefined;
  if (!pages) return values;

  for (const [pageKey, rawPage] of Object.entries(pages)) {
    const referencePage = view.pages[pageKey];
    const rawSections = referencePage && isRecord(rawPage) && isRecord(rawPage.sections) ? rawPage.sections : undefined;
    if (!referencePage || !rawSections) continue;

    for (const [sectionKey, rawSection] of Object.entries(rawSections)) {
      const referenceSection = referencePage.sections[sectionKey];
      if (!referenceSection || !isRecord(rawSection)) continue;

      if (referenceSection.fields && isRecord(rawSection.fields)) {
        for (const [fieldKey, value] of Object.entries(rawSection.fields)) {
          const ref = referenceSection.fields[fieldKey];
          if (ref?.editable && typeof value === "string") values[ref.id] = value;
        }
      }

      if (referenceSection.instances && Array.isArray(rawSection.instances)) {
        rawSection.instances.forEach((rawInstance: unknown, index: number) => {
          const referenceInstance = referenceSection.instances?.[index];
          if (!referenceInstance || !isRecord(rawInstance)) return;
          for (const [fieldKey, value] of Object.entries(rawInstance)) {
            const ref = referenceInstance[fieldKey];
            if (ref?.editable && typeof value === "string") values[ref.id] = value;
          }
        });
      }
    }
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
