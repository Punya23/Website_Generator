/** Fill an authored site skin with business copy — layout stays frozen. */
import type { PageBlueprint, PagePlan, SectionInstance, SiteContext } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm, strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { getTemplate } from "../section-templates/registry.js";
import { COPY_PROP_SCHEMAS, type TemplateId } from "../section-templates/schemas.js";
import { repairTemplateProps } from "../section-templates/repair-props.js";
import { enrichPropsImages } from "./media-curator-agent.js";
import { mockPropsForTemplate } from "./section-props-shared.js";
import { minimalBriefContext } from "./page-codegen-agent.js";
import { stampContactFormProps } from "../forms/contact-form.js";
import type { MediaRegistry } from "../media/media-registry.js";
import { skinSectionId, type SiteSkin, type SkinSection } from "../skins/schema.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";

const LAYOUT_KEYS = new Set([
  "layoutVariant",
  "density",
  "mediaPosition",
  "visualFx",
  "surface",
  "bandFill",
  "panel",
  "divider",
  "mediaOverlay",
  "formProvider",
  "formAccessKey",
  "formEmail",
  "formAction",
  "redirectPath",
]);

const SKIN_FILL_PROMPT = `You write visitor-facing copy for a finished website layout.

The layout is FROZEN. You do not pick sections, change order, or invent new components.
You only fill the named slots with specific copy for THIS business.

RULES:
- Return JSON only: { "pages": { "<slug>": { "<sectionId>": { ...props } } } }
- Every listed sectionId must be present
- Do not add layoutVariant, density, mediaPosition, or form backend keys
- For images use { "alt": "descriptive alt" } or { "imageQuery": "search phrase" } — never src URLs
- FeatureBento: 3–6 items; set span "wide" or "large" on at least one
- OfferIndex: 3–8 items with title and description — numbered list, not cards
- MenuBoard: 3–12 items with name and price
- HoursLocation: schedule is [{ day, time }, ...] — never a string named hours
- StorySplit: paragraphs is 1–4 strings; optional pullQuote
- QuoteCalculator packages: 2–4 items with numeric pricePerUnit
- Headlines must be specific to this business — no "Welcome to", "Elevate your", "Crafting X Experiences"
- CTAs href: inner pages "/about" "/services" "/contact"; primary conversion CTAs go to "/contact"
`;

export function copySlotFields(templateId: string): string[] {
  const schema = COPY_PROP_SCHEMAS[templateId as TemplateId] as { shape?: Record<string, unknown> } | undefined;
  if (!schema?.shape) return ["headline"];
  return Object.keys(schema.shape).filter((key) => !LAYOUT_KEYS.has(key));
}

export function slotSchemaForSkin(skin: SiteSkin, onlyIds?: Set<string>): string {
  const lines: string[] = [];
  for (const [slug, sections] of Object.entries(skin.pages)) {
    const rows: string[] = [];
    sections.forEach((section, index) => {
      const id = skinSectionId(slug, index, section.templateId);
      if (onlyIds && !onlyIds.has(id)) return;
      const fields = copySlotFields(section.templateId).join(", ");
      rows.push(`- ${id} [${section.templateId}] intent="${section.intent}" fields: ${fields}`);
    });
    if (rows.length === 0) continue;
    lines.push(`PAGE ${slug}:`, ...rows);
  }
  return lines.join("\n");
}

export function validateFilledCopy(
  templateId: string,
  props: Record<string, unknown>
): { ok: true; props: Record<string, unknown> } | { ok: false; error: string } {
  const schema = COPY_PROP_SCHEMAS[templateId as TemplateId];
  if (!schema) return { ok: false, error: `Unknown template ${templateId}` };
  const repaired = repairTemplateProps(templateId, props);
  const parsed = schema.safeParse(repaired);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `${templateId}: ${detail}` };
  }
  return { ok: true, props: repaired };
}

function layoutProps(section: SkinSection): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (section.layoutVariant) out.layoutVariant = section.layoutVariant;
  if (section.density) out.density = section.density;
  if (section.mediaPosition) out.mediaPosition = section.mediaPosition;
  return out;
}

export function applyFrozenLayout(
  templateId: string,
  copy: Record<string, unknown>,
  section: SkinSection,
  ctx: SiteContext
): Record<string, unknown> {
  let props = { ...copy, ...layoutProps(section) };
  if (templateId === "contact_split") {
    props = stampContactFormProps(props, ctx.businessName);
  }
  return props;
}

function extractPageMap(parsed: Record<string, unknown>): Record<string, unknown> {
  const pages = parsed.pages;
  if (pages && typeof pages === "object" && !Array.isArray(pages)) {
    return pages as Record<string, unknown>;
  }
  return parsed;
}

function propsForSection(
  pageValue: unknown,
  sectionId: string,
  index: number
): Record<string, unknown> {
  if (Array.isArray(pageValue)) {
    const row = pageValue[index];
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const obj = row as Record<string, unknown>;
      if (obj.props && typeof obj.props === "object" && !Array.isArray(obj.props)) {
        return obj.props as Record<string, unknown>;
      }
      return obj;
    }
    return {};
  }
  if (pageValue && typeof pageValue === "object") {
    const map = pageValue as Record<string, unknown>;
    const direct = map[sectionId];
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      const obj = direct as Record<string, unknown>;
      if (obj.props && typeof obj.props === "object" && !Array.isArray(obj.props)) {
        return obj.props as Record<string, unknown>;
      }
      return obj;
    }
  }
  return {};
}

export function mockFillSkinCopy(ctx: SiteContext, skin: SiteSkin): Record<string, Record<string, Record<string, unknown>>> {
  const pages: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [slug, sections] of Object.entries(skin.pages)) {
    pages[slug] = {};
    sections.forEach((section, index) => {
      const id = skinSectionId(slug, index, section.templateId);
      const blueprintSection = { id, templateId: section.templateId, intent: section.intent };
      let props = mockPropsForTemplate(
        section.templateId,
        blueprintSection,
        ctx.expandedBrief,
        slug,
        ctx.verticalProfile as VerticalDesignProfile | undefined
      );
      if (section.templateId === "quote_calculator" && skin.widgetUnit) {
        props.unitLabel = skin.widgetUnit;
      }
      pages[slug]![id] = props;
    });
  }
  return pages;
}

function mergeFill(
  skin: SiteSkin,
  llmPages: Record<string, unknown>
): { copy: Record<string, Record<string, Record<string, unknown>>> } {
  const copy: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [slug, sections] of Object.entries(skin.pages)) {
    copy[slug] = {};
    const pageValue = llmPages[slug];
    sections.forEach((section, index) => {
      const id = skinSectionId(slug, index, section.templateId);
      copy[slug]![id] = propsForSection(pageValue, id, index);
    });
  }
  return { copy };
}

export async function instancesFromSkinCopy(
  ctx: SiteContext,
  skin: SiteSkin,
  copyByPage: Record<string, Record<string, Record<string, unknown>>>,
  registry: MediaRegistry,
  options?: { enrichMedia?: boolean }
): Promise<Record<string, SectionInstance[]>> {
  const result: Record<string, SectionInstance[]> = {};
  for (const [slug, sections] of Object.entries(skin.pages)) {
    const instances: SectionInstance[] = [];
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]!;
      const id = skinSectionId(slug, index, section.templateId);
      const template = getTemplate(section.templateId);
      if (!template) throw new Error(`Unknown template ${section.templateId} in skin ${skin.id}`);
      let props = { ...(copyByPage[slug]?.[id] ?? {}) };
      if (section.templateId === "quote_calculator" && skin.widgetUnit && !props.unitLabel) {
        props.unitLabel = skin.widgetUnit;
      }
      props = applyFrozenLayout(section.templateId, props, section, ctx);
      const validated = validateFilledCopy(section.templateId, props);
      props = validated.ok ? validated.props : repairTemplateProps(section.templateId, props);
      props = { ...props, ...layoutProps(section) };
      if (section.templateId === "contact_split") {
        props = stampContactFormProps(props, ctx.businessName);
      }
      if (options?.enrichMedia !== false) {
        props = await enrichPropsImages(section.templateId, props, ctx, id, slug, registry);
      }
      instances.push({
        id,
        templateId: section.templateId,
        intent: section.intent,
        props,
        fullBleed: template.sectionMode === "bleed",
        motion: template.defaultMotion,
        layoutSpec: {
          variant: section.layoutVariant ?? "default",
          density: section.density,
          mediaPosition: section.mediaPosition,
        },
      });
    }
    result[slug] = instances;
  }
  return result;
}

export function skinInstancesToBlueprints(
  skin: SiteSkin,
  instances: Record<string, SectionInstance[]>
): PageBlueprint[] {
  return Object.keys(skin.pages).map((slug) => ({
    slug,
    rhythm: "mixed",
    sections: (instances[slug] ?? []).map((section) => ({
      id: section.id,
      templateId: section.templateId,
      intent: section.intent,
    })),
  }));
}

function pagePlansFromSkin(ctx: SiteContext, skin: SiteSkin): PagePlan[] {
  return Object.keys(skin.pages).map((slug) => {
    const existing = ctx.sitePlan.pages.find((page) => page.slug === slug);
    return (
      existing ?? {
        slug,
        title: slug,
        navLabel: slug,
        goal: slug,
        minBlocks: 4,
        layoutHint: slug,
        contentFocus: [slug],
      }
    );
  });
}

function buildUserPrompt(
  ctx: SiteContext,
  skin: SiteSkin,
  validationError?: string,
  onlyIds?: Set<string>
): string {
  const retry = validationError
    ? `\n\nPRIOR ATTEMPT FAILED: ${validationError}\nFill every listed sectionId. JSON only.`
    : "";
  // An ingested skin's name and description are provenance prose ("recipe from owner/repo …"),
  // not art direction. Putting a stranger's repo name in front of the copywriter buys nothing and
  // risks it bleeding into the generated copy, so ingested skins contribute only their id.
  const identity = skin.provenance
    ? `Skin: ${skin.id}`
    : `Skin: ${skin.id} — ${skin.name}\n${skin.description}`;

  return `${minimalBriefContext(ctx)}

Design mood: ${ctx.designSystem.mood}
${identity}
Widget: ${skin.widget}${skin.widgetUnit ? ` (${skin.widgetUnit})` : ""}

SLOTS:
${slotSchemaForSkin(skin, onlyIds)}
${retry}

Fill every slot now.`;
}

/** Build the final per-page copy map from whatever sections validated, filling any
 *  still-broken ids from `fallback` (mock copy) so one bad section can't blank the rest. */
function pagesFromCopyMap(
  skin: SiteSkin,
  accepted: Map<string, Record<string, unknown>>,
  fallback: Record<string, Record<string, Record<string, unknown>>>
): Record<string, Record<string, Record<string, unknown>>> {
  const pages: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [slug, sections] of Object.entries(skin.pages)) {
    pages[slug] = {};
    sections.forEach((section, index) => {
      const id = skinSectionId(slug, index, section.templateId);
      pages[slug]![id] = accepted.get(id) ?? fallback[slug]?.[id] ?? {};
    });
  }
  return pages;
}

export async function fillSiteSkin(
  ctx: SiteContext,
  skin: SiteSkin,
  registry: MediaRegistry
): Promise<{ instances: Record<string, SectionInstance[]>; blueprints: PageBlueprint[] }> {
  requireLlm("skin fill");

  const mockCopy = mockFillSkinCopy(ctx, skin);
  let copyByPage = mockCopy;

  if (llm.isAvailable) {
    const allIds: string[] = [];
    for (const [slug, sections] of Object.entries(skin.pages)) {
      sections.forEach((section, index) => allIds.push(skinSectionId(slug, index, section.templateId)));
    }
    // Sections that pass validation are kept even if a later attempt (or a different
    // section) fails — one bad enum shouldn't discard bespoke copy for the rest of the site.
    const accepted = new Map<string, Record<string, unknown>>();
    let outstanding = new Set<string>(allIds);
    let lastError: string | undefined;

    for (let attempt = 0; attempt < 3 && outstanding.size > 0; attempt++) {
      const onlyIds = attempt > 0 ? outstanding : undefined;
      let parsed: Record<string, unknown>;
      try {
        parsed = await chatJsonWithRetry(
          "skin fill",
          SKIN_FILL_PROMPT,
          (parseError) => buildUserPrompt(ctx, skin, parseError ?? lastError, onlyIds),
          {
            tokenRole: "page",
            model: llm.getPageCodegenModel(),
            initialTemperature: 0.7,
            maxAttempts: 2,
          },
          (raw) => parseLlmJson(raw) as Record<string, unknown>
        );
      } catch (err) {
        // A malformed-JSON exhaustion here only means *this* attempt produced nothing usable —
        // fall through to the next outer attempt instead of discarding sections already accepted.
        if (strictLlmRequired()) {
          recordFallback("skin_fill");
          handleLlmFailure("skin fill", err);
        }
        lastError = err instanceof Error ? err.message : String(err);
        pipelineLog(`[pipeline] Skin fill attempt ${attempt + 1}/3 produced no usable JSON: ${lastError}`);
        continue;
      }

      const { copy } = mergeFill(skin, extractPageMap(parsed));
      const errors: string[] = [];
      const stillBad = new Set<string>();
      for (const [slug, sections] of Object.entries(skin.pages)) {
        sections.forEach((section, index) => {
          const id = skinSectionId(slug, index, section.templateId);
          if (!outstanding.has(id)) return;
          const props = copy[slug]?.[id] ?? {};
          if (Object.keys(props).length === 0) {
            stillBad.add(id);
            errors.push(`${id}: missing`);
            return;
          }
          const check = validateFilledCopy(section.templateId, props);
          if (check.ok) accepted.set(id, check.props);
          else {
            stillBad.add(id);
            errors.push(`${id}: ${check.error}`);
          }
        });
      }
      outstanding = stillBad;
      if (errors.length) {
        lastError = errors.slice(0, 8).join(" | ");
        pipelineLog(`[pipeline] Skin fill validation failed (attempt ${attempt + 1}/3): ${lastError}`);
      }
    }

    if (outstanding.size === 0 && accepted.size === allIds.length) {
      copyByPage = pagesFromCopyMap(skin, accepted, mockCopy);
    } else if (accepted.size > 0) {
      for (const id of outstanding) recordFallback("skin_fill", id);
      pipelineLog(
        `[pipeline] Skin fill: ${accepted.size}/${allIds.length} section(s) used bespoke copy; mock copy used for: ${[...outstanding].join(", ")}`
      );
      copyByPage = pagesFromCopyMap(skin, accepted, mockCopy);
    } else {
      recordFallback("skin_fill");
      pipelineLog(`[pipeline] Skin fill fell back to mock copy entirely: ${lastError ?? "validation failed"}`);
    }
  } else if (!allowMocks()) {
    throw new Error("Skin fill requires LLM");
  } else {
    recordFallback("skin_fill");
  }

  const instances = await instancesFromSkinCopy(ctx, skin, copyByPage, registry);
  return { instances, blueprints: skinInstancesToBlueprints(skin, instances) };
}

export { pagePlansFromSkin };
