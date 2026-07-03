/** Media Curator — imageQuery fields only for one section template. */
import type { SiteContext } from "../types.js";
import type { BlueprintSection } from "./page-composer-agent.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm, strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { getTemplate } from "../section-templates/registry.js";
import { MediaRegistry } from "../media/media-registry.js";
import { resolveUniqueImage } from "../media/enrich-content.js";
import { freezeSnapshot, type SectionMediaSnapshot } from "./contracts/index.js";
import { mockPropsForTemplate } from "./section-props-shared.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { chatJsonWithRetry } from "../llm/json-agent.js";
import { coerceImageQuery } from "../section-templates/schemas.js";
import { recordFallback } from "../util/fallback-tracker.js";

const MEDIA_PROMPT = `You are a visual media curator for ONE website section.

INPUT (read-only): section intent, template type, existing copy props, vertical image hints.
OUTPUT (your only job): JSON with image/imageQuery fields ONLY.
FORBIDDEN: Do not change headlines, body copy, CTAs, or colors.

Rules:
- Use imageQuery (never src) — one plain string per image, never an array
- Match image mood to section intent, business vertical, and imageHints
- For arrays (items, members, projects, images): include imageQuery per item when template supports images
- Output only fields that need images — omit text fields`;

type ImageFieldSpec =
  | { field: string; queryFrom?: string; defaultQuery?: string }
  | { array: string; imageKey: string; queryFrom?: string; defaultQuery?: string };

const TEMPLATE_IMAGE_FIELDS: Record<string, ImageFieldSpec[]> = {
  hero_editorial: [{ field: "image", queryFrom: "headline" }],
  hero_split_cinematic: [{ field: "image", queryFrom: "headline" }],
  hero_spotlight: [{ field: "image", queryFrom: "headline" }],
  services_showcase: [{ field: "image", queryFrom: "headline" }],
  scroll_showcase: [{ field: "image", queryFrom: "headline" }],
  hero_video: [{ field: "video", nested: "poster", queryFrom: "headline" } as ImageFieldSpec & { nested: string }],
  before_after: [
    { field: "before", defaultQuery: "before transformation" },
    { field: "after", defaultQuery: "after transformation" },
  ],
  testimonial_carousel: [{ array: "items", imageKey: "avatar", queryFrom: "author", defaultQuery: "client portrait" }],
  portfolio_carousel: [{ array: "slides", imageKey: "image", queryFrom: "title", defaultQuery: "portfolio" }],
  feature_bento: [{ array: "items", imageKey: "image", queryFrom: "title", defaultQuery: "feature" }],
  portfolio_strip: [{ array: "projects", imageKey: "image", queryFrom: "title", defaultQuery: "project" }],
  team_grid: [{ array: "members", imageKey: "image", queryFrom: "name", defaultQuery: "team portrait" }],
  horizontal_gallery: [{ array: "items", imageKey: "image", queryFrom: "title", defaultQuery: "gallery" }],
  gallery_masonry: [{ array: "images", imageKey: "image", defaultQuery: "gallery" }],
};

function buildMediaUserPrompt(snapshot: SectionMediaSnapshot, profile?: VerticalDesignProfile): string {
  return `Business: ${snapshot.businessName}
Section: ${snapshot.section.id} — ${snapshot.section.intent}
Template: ${snapshot.section.templateId}
Vertical profile: ${profile?.profileId ?? "generic"}
Image hints: ${profile?.imageHints ?? "professional stock photography"}
Existing copy: ${JSON.stringify(snapshot.copyProps).slice(0, 800)}`;
}

function unwrapMediaProps(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.props && typeof parsed.props === "object" && !Array.isArray(parsed.props)) {
    return parsed.props as Record<string, unknown>;
  }
  return parsed;
}

function normalizeMediaProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(props)) {
    if (typeof val === "string" && (key === "image" || key === "before" || key === "after")) {
      const q = coerceImageQuery(val);
      out[key] = q ? { imageQuery: q } : {};
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = { ...(val as Record<string, unknown>) };
      if ("imageQuery" in obj) obj.imageQuery = coerceImageQuery(obj.imageQuery);
      if (obj.poster && typeof obj.poster === "object" && !Array.isArray(obj.poster)) {
        const poster = { ...(obj.poster as Record<string, unknown>) };
        if ("imageQuery" in poster) poster.imageQuery = coerceImageQuery(poster.imageQuery);
        obj.poster = poster;
      }
      out[key] = obj;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const row = { ...(item as Record<string, unknown>) };
        for (const imgKey of ["image", "avatar"]) {
          const nested = row[imgKey];
          if (typeof nested === "string") {
            const q = coerceImageQuery(nested);
            row[imgKey] = q ? { imageQuery: q } : {};
          } else if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            const img = { ...(nested as Record<string, unknown>) };
            if ("imageQuery" in img) img.imageQuery = coerceImageQuery(img.imageQuery);
            row[imgKey] = img;
          }
        }
        if ("imageQuery" in row) row.imageQuery = coerceImageQuery(row.imageQuery);
        return row;
      });
    } else {
      out[key] = val;
    }
  }
  return out;
}

async function fetchMediaPropsFromLlm(
  snapshot: SectionMediaSnapshot,
  profile?: VerticalDesignProfile
): Promise<Record<string, unknown>> {
  return chatJsonWithRetry(
    `media curator ${snapshot.section.id}`,
    MEDIA_PROMPT,
    (parseError) => {
      const suffix = parseError
        ? `\n\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Output valid JSON only.`
        : "";
      return buildMediaUserPrompt(snapshot, profile) + suffix;
    },
    { tokenRole: "section", model: llm.getSectionModel(), initialTemperature: 0.5 },
    (raw) => normalizeMediaProps(unwrapMediaProps(parseLlmJson<Record<string, unknown>>(raw)))
  );
}

export async function curateSectionMedia(
  ctx: SiteContext,
  pageSlug: string,
  section: BlueprintSection,
  copyProps: Record<string, unknown>,
  registry: MediaRegistry,
  prefillMedia?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const template = getTemplate(section.templateId);
  if (!template) return {};

  const profile = ctx.verticalProfile as VerticalDesignProfile | undefined;

  const snapshot = freezeSnapshot<SectionMediaSnapshot>({
    businessName: ctx.businessName,
    brief: ctx.expandedBrief,
    pageSlug,
    section: { id: section.id, templateId: section.templateId, intent: section.intent },
    copyProps,
    verticalProfile: ctx.verticalProfile,
    imageHints: profile?.imageHints,
  });

  let mediaProps: Record<string, unknown> = prefillMedia ?? {};

  if (!prefillMedia && llm.isAvailable) {
    try {
      mediaProps = await fetchMediaPropsFromLlm(snapshot, profile);
    } catch (err) {
      recordFallback("media_curator", section.id);
      pipelineLog(
        `[pipeline] Media curator ${section.id} failed: ${err instanceof Error ? err.message : String(err)} — using mock media`
      );
      if (strictLlmRequired()) handleLlmFailure(`media curator ${section.id}`, err);
      mediaProps = extractMediaFromMock(section, ctx, pageSlug);
    }
  } else if (!prefillMedia) {
    if (!allowMocks()) requireLlm("media curator");
    mediaProps = extractMediaFromMock(section, ctx, pageSlug);
  }

  return enrichTemplateImages(
    section.templateId,
    mediaProps,
    ctx,
    section.id,
    pageSlug,
    registry,
    copyProps
  );
}

function extractMediaFromMock(
  section: BlueprintSection,
  ctx: SiteContext,
  pageSlug: string
): Record<string, unknown> {
  const full = mockPropsForTemplate(
    section.templateId,
    section,
    ctx.expandedBrief,
    pageSlug,
    ctx.verticalProfile as VerticalDesignProfile | undefined
  );
  const media: Record<string, unknown> = {};
  if (full.image) media.image = full.image;
  if (full.items) media.items = full.items;
  if (full.members) media.members = full.members;
  if (full.projects) media.projects = full.projects;
  if (full.images) media.images = full.images;
  return media;
}

function verticalQuerySuffix(ctx: SiteContext): string {
  const profile = ctx.verticalProfile as VerticalDesignProfile | undefined;
  return profile?.imageHints ?? profile?.industryFamily ?? "";
}

async function enrichTemplateImages(
  templateId: string,
  mediaProps: Record<string, unknown>,
  ctx: SiteContext,
  sectionId: string,
  pageSlug: string,
  registry: MediaRegistry,
  copyProps: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const out = { ...mediaProps };
  const brief = ctx.expandedBrief.expandedBrief;
  const business = ctx.businessName;
  const vertical = verticalQuerySuffix(ctx);

  async function enrichImageField(
    obj: Record<string, unknown>,
    key: string,
    query: string
  ): Promise<void> {
    const field = obj[key];
    if (!field || typeof field !== "object") return;
    const img = field as Record<string, unknown>;
    if (img.src && String(img.src).startsWith("https://")) return;
    const q = String(img.imageQuery ?? query);
    const cacheKey = `${sectionId}-${key}-${ctx.variationSeed ?? 0}`;
    const src = await resolveUniqueImage(
      `${brief} ${business} ${q}`,
      cacheKey,
      registry,
      sectionId,
      sectionId,
      pageSlug,
      1400,
      900,
      vertical
    );
    obj[key] = { ...img, src, alt: img.alt ?? query };
  }

  const specs = TEMPLATE_IMAGE_FIELDS[templateId] ?? [];
  for (const spec of specs) {
    if ("field" in spec && spec.field) {
      const nested = (spec as ImageFieldSpec & { nested?: string }).nested;
      if (nested) {
        if (!out[spec.field]) {
          out[spec.field] = { [nested]: { imageQuery: business, alt: business } };
        }
        const parent = { ...(out[spec.field] as Record<string, unknown>) };
        await enrichImageField(
          parent,
          nested,
          String(copyProps[spec.queryFrom ?? "headline"] ?? business)
        );
        out[spec.field] = parent;
        continue;
      }
      if (!out[spec.field]) {
        out[spec.field] = {
          imageQuery: String(copyProps[spec.queryFrom ?? "headline"] ?? business),
          alt: business,
        };
      }
      await enrichImageField(
        out,
        spec.field,
        String(copyProps[spec.queryFrom ?? "headline"] ?? spec.defaultQuery ?? business)
      );
    }
    if ("array" in spec && spec.array) {
      if (!Array.isArray(out[spec.array])) continue;
      const items = [...(out[spec.array] as Record<string, unknown>[])];
      for (let i = 0; i < items.length; i++) {
        const item = { ...items[i]! };
        if (!item[spec.imageKey]) {
          item[spec.imageKey] = {
            imageQuery: String(item[spec.queryFrom ?? "title"] ?? spec.defaultQuery ?? "gallery"),
            alt: String(item[spec.queryFrom ?? "title"] ?? "Image"),
          };
        }
        await enrichImageField(
          item,
          spec.imageKey,
          String(item[spec.queryFrom ?? "title"] ?? spec.defaultQuery ?? "gallery")
        );
        items[i] = item;
      }
      out[spec.array] = items;
    }
  }

  if (templateId === "gallery_masonry" && Array.isArray(out.images)) {
    const images = [...(out.images as Record<string, unknown>[])];
    for (let i = 0; i < images.length; i++) {
      const img = { ...images[i]! };
      if (!img.src) {
        const src = await resolveUniqueImage(
          `${brief} ${business} gallery`,
          `${sectionId}-img-${i}-${ctx.variationSeed ?? 0}`,
          registry,
          sectionId,
          sectionId,
          pageSlug,
          1000,
          1200,
          vertical
        );
        images[i] = { ...img, src, alt: img.alt ?? img.caption ?? "Gallery image" };
      }
    }
    out.images = images;
  }

  return out;
}
