import { z } from "zod";
import {
  MotionPresetSchema,
  NavShapeSchema,
  NavTreatmentSchema,
  PageToneSchema,
  type ReactPage,
  type SectionInstance,
  type SiteContext,
  type SiteTheme,
} from "../types.js";
import { TEMPLATE_IDS, getTemplate } from "../section-templates/registry.js";
import { validateFilledCopy } from "../agents/skin-fill-agent.js";
import { mockPropsForTemplate } from "../agents/section-props-shared.js";
import { stampContactFormProps } from "../forms/contact-form.js";
import { applyThemePatch } from "./rerender.js";
import { repairTemplateProps } from "../section-templates/repair-props.js";

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

const CTA_TEMPLATES = new Set(["cta_band", "footer_cta"]);

export const RevisionKindSchema = z.enum([
  "theme",
  "copy",
  "reorder",
  "swap",
  "insert",
  "remove",
  "refuse",
]);

export type RevisionKind = z.infer<typeof RevisionKindSchema>;

export const ThemeRevisionSchema = z
  .object({
    fontHeading: z.string().min(2).optional(),
    fontBody: z.string().min(2).optional(),
    mood: z.string().min(2).optional(),
    navShape: NavShapeSchema.optional(),
    navTreatment: NavTreatmentSchema.optional(),
    pageTone: PageToneSchema.optional(),
    motionPreset: MotionPresetSchema.optional(),
    colors: z
      .object({
        bg: z.string().optional(),
        surface: z.string().optional(),
        text: z.string().optional(),
        muted: z.string().optional(),
        accent: z.string().optional(),
        accentSoft: z.string().optional(),
        gradientFrom: z.string().optional(),
        gradientTo: z.string().optional(),
        navBg: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export const RevisionPatchSchema = z.object({
  kind: RevisionKindSchema,
  summary: z.string().min(3),
  reason: z.string().optional(),
  theme: ThemeRevisionSchema.optional(),
  pageSlug: z.string().optional(),
  sectionId: z.string().optional(),
  props: z.record(z.unknown()).optional(),
  sectionIds: z.array(z.string()).optional(),
  templateId: z.string().optional(),
  intent: z.string().optional(),
  afterSectionId: z.string().optional(),
  index: z.number().int().optional(),
});

export type RevisionPatch = z.infer<typeof RevisionPatchSchema>;

export interface ApplyRevisionResult {
  kind: RevisionKind;
  summary: string;
  reason?: string;
  pageSlug?: string;
}

export function parseRevisionPatch(raw: unknown): RevisionPatch {
  return RevisionPatchSchema.parse(raw);
}

export function pageBounds(slug: string): { min: number; max: number } {
  return slug === "home" ? { min: 3, max: 8 } : { min: 2, max: 6 };
}

export function isHeroTemplate(templateId: string): boolean {
  return templateId.startsWith("hero_");
}

export function catalogForRevision(ctx: SiteContext): string {
  const pages = ctx.reactPages ?? {};
  const lines: string[] = [];
  for (const [slug, page] of Object.entries(pages)) {
    const bound = pageBounds(slug);
    lines.push(
      `PAGE ${slug} (${page.sections.length} sections, keep ${bound.min}-${bound.max}):`
    );
    for (const section of page.sections) {
      lines.push(`- ${section.id} [${section.templateId}] ${section.intent}`);
    }
  }
  const ds = ctx.designSystem;
  lines.push(
    `THEME mood="${ds.mood}" heading=${ds.fontHeading} accent=${ds.colors.accent} bg=${ds.colors.bg} navShape=${ds.navShape ?? "full-width"}`
  );
  lines.push(`TEMPLATES: ${TEMPLATE_IDS.join(", ")}`);
  return lines.join("\n");
}

function copyPropsOnly(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!LAYOUT_KEYS.has(key)) out[key] = value;
  }
  return out;
}

function findSection(
  pages: Record<string, ReactPage>,
  sectionId: string
): { slug: string; page: ReactPage; index: number; section: SectionInstance } {
  for (const [slug, page] of Object.entries(pages)) {
    const index = page.sections.findIndex((section) => section.id === sectionId);
    if (index >= 0) {
      return { slug, page, index, section: page.sections[index]! };
    }
  }
  throw new Error(`Section not found: ${sectionId}`);
}

function requirePages(ctx: SiteContext): Record<string, ReactPage> {
  const pages = ctx.reactPages;
  if (!pages || Object.keys(pages).length === 0) {
    throw new Error("No React site in session — generate a site first");
  }
  return pages;
}

function requirePage(pages: Record<string, ReactPage>, slug: string): ReactPage {
  const page = pages[slug];
  if (!page) throw new Error(`Page not found: ${slug}`);
  return page;
}

function insertIndex(sections: SectionInstance[], patch: RevisionPatch): number {
  if (typeof patch.index === "number") {
    return Math.max(0, Math.min(patch.index, sections.length));
  }
  if (patch.afterSectionId) {
    const at = sections.findIndex((section) => section.id === patch.afterSectionId);
    if (at >= 0) return at + 1;
  }
  for (let i = sections.length - 1; i >= 0; i--) {
    if (CTA_TEMPLATES.has(sections[i]!.templateId)) return i;
  }
  return sections.length;
}

function newSectionId(slug: string, templateId: string): string {
  return `rev_${slug}_${templateId.replace(/_/g, "")}_${Date.now().toString(36)}`;
}

function buildInstance(
  ctx: SiteContext,
  slug: string,
  templateId: string,
  intent: string,
  id: string,
  extraProps?: Record<string, unknown>
): SectionInstance {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  const blueprint = { id, templateId, intent };
  let props = mockPropsForTemplate(templateId, blueprint, ctx.expandedBrief, slug);
  if (extraProps) props = { ...props, ...copyPropsOnly(extraProps) };
  props = repairTemplateProps(templateId, props);
  if (templateId === "contact_split") {
    props = stampContactFormProps(props, ctx.businessName);
  }
  const validated = validateFilledCopy(templateId, props);
  if (!validated.ok) {
    props = repairTemplateProps(templateId, props);
  } else {
    props = validated.props;
  }
  return {
    id,
    templateId,
    intent,
    props,
    fullBleed: template.sectionMode === "bleed",
    motion: template.defaultMotion,
  };
}

function applyTheme(ctx: SiteContext, patch: RevisionPatch): ApplyRevisionResult {
  if (!patch.theme || Object.keys(patch.theme).length === 0) {
    throw new Error("Theme revision is missing a theme patch");
  }
  applyThemePatch(ctx, patch.theme as Partial<SiteTheme>);
  return { kind: "theme", summary: patch.summary };
}

function applyCopy(ctx: SiteContext, patch: RevisionPatch): ApplyRevisionResult {
  if (!patch.sectionId) throw new Error("Copy revision needs sectionId");
  const pages = requirePages(ctx);
  const found = findSection(pages, patch.sectionId);
  const incoming = copyPropsOnly(patch.props ?? {});
  const merged = repairTemplateProps(found.section.templateId, {
    ...found.section.props,
    ...incoming,
  });
  if (found.section.templateId === "contact_split") {
    Object.assign(merged, stampContactFormProps(merged, ctx.businessName));
  }
  const validated = validateFilledCopy(found.section.templateId, merged);
  if (!validated.ok) throw new Error(validated.error);
  found.section.props = validated.props;
  return { kind: "copy", summary: patch.summary, pageSlug: found.slug };
}

function applyReorder(ctx: SiteContext, patch: RevisionPatch): ApplyRevisionResult {
  const slug = patch.pageSlug;
  if (!slug || !patch.sectionIds?.length) {
    throw new Error("Reorder revision needs pageSlug and sectionIds");
  }
  const page = requirePage(requirePages(ctx), slug);
  if (patch.sectionIds.length !== page.sections.length) {
    throw new Error("Reorder must include every section on the page");
  }
  const map = new Map(page.sections.map((section) => [section.id, section]));
  page.sections = patch.sectionIds.map((id) => {
    const section = map.get(id);
    if (!section) throw new Error(`Section not found: ${id}`);
    return section;
  });
  return { kind: "reorder", summary: patch.summary, pageSlug: slug };
}

function applySwap(ctx: SiteContext, patch: RevisionPatch): ApplyRevisionResult {
  if (!patch.sectionId || !patch.templateId) {
    throw new Error("Swap revision needs sectionId and templateId");
  }
  if (!getTemplate(patch.templateId)) {
    throw new Error(`Unknown template: ${patch.templateId}`);
  }
  const found = findSection(requirePages(ctx), patch.sectionId);
  const fromHero = isHeroTemplate(found.section.templateId);
  const toHero = isHeroTemplate(patch.templateId);
  if (fromHero !== toHero) {
    throw new Error("Hero sections can only swap with another hero_* template");
  }
  const next = buildInstance(
    ctx,
    found.slug,
    patch.templateId,
    patch.intent ?? found.section.intent,
    found.section.id
  );
  found.page.sections[found.index] = {
    ...next,
    layoutSpec: found.section.layoutSpec,
  };
  return { kind: "swap", summary: patch.summary, pageSlug: found.slug };
}

function applyInsert(ctx: SiteContext, patch: RevisionPatch): ApplyRevisionResult {
  const slug = patch.pageSlug ?? "home";
  if (!patch.templateId) throw new Error("Insert revision needs templateId");
  if (!getTemplate(patch.templateId)) {
    throw new Error(`Unknown template: ${patch.templateId}`);
  }
  if (isHeroTemplate(patch.templateId)) {
    throw new Error("Use swap to change the hero — do not insert a second hero");
  }
  const page = requirePage(requirePages(ctx), slug);
  const { max } = pageBounds(slug);
  if (page.sections.length >= max) {
    throw new Error(`${slug} already has ${page.sections.length} sections (max ${max})`);
  }
  const instance = buildInstance(
    ctx,
    slug,
    patch.templateId,
    patch.intent ?? patch.templateId.replace(/_/g, " "),
    newSectionId(slug, patch.templateId),
    patch.props
  );
  page.sections.splice(insertIndex(page.sections, patch), 0, instance);
  return { kind: "insert", summary: patch.summary, pageSlug: slug };
}

function applyRemove(ctx: SiteContext, patch: RevisionPatch): ApplyRevisionResult {
  if (!patch.sectionId) throw new Error("Remove revision needs sectionId");
  const found = findSection(requirePages(ctx), patch.sectionId);
  const { min } = pageBounds(found.slug);
  if (found.page.sections.length <= min) {
    throw new Error(`${found.slug} must keep at least ${min} sections`);
  }
  if (isHeroTemplate(found.section.templateId)) {
    const heroes = found.page.sections.filter((section) => isHeroTemplate(section.templateId));
    if (heroes.length <= 1) throw new Error("Cannot remove the only hero");
  }
  if (CTA_TEMPLATES.has(found.section.templateId)) {
    const ctas = found.page.sections.filter((section) => CTA_TEMPLATES.has(section.templateId));
    if (ctas.length <= 1) throw new Error("Cannot remove the only conversion CTA");
  }
  found.page.sections.splice(found.index, 1);
  return { kind: "remove", summary: patch.summary, pageSlug: found.slug };
}

export function applyRevision(ctx: SiteContext, patch: RevisionPatch): ApplyRevisionResult {
  const parsed = parseRevisionPatch(patch);
  switch (parsed.kind) {
    case "refuse":
      return { kind: "refuse", summary: parsed.summary, reason: parsed.reason };
    case "theme":
      return applyTheme(ctx, parsed);
    case "copy":
      return applyCopy(ctx, parsed);
    case "reorder":
      return applyReorder(ctx, parsed);
    case "swap":
      return applySwap(ctx, parsed);
    case "insert":
      return applyInsert(ctx, parsed);
    case "remove":
      return applyRemove(ctx, parsed);
  }
}
