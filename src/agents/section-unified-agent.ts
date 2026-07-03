/** Single LLM call for copy + media fields per section (fast path). */
import type { SiteContext } from "../types.js";
import type { BlueprintSection } from "./page-composer-agent.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { allowMocks, requireLlm, strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { getTemplate, validateCopyProps } from "../section-templates/registry.js";
import { COPY_PROP_SCHEMAS } from "../section-templates/schemas.js";
import { freezeSnapshot, type SectionCopySnapshot } from "./contracts/index.js";
import {
  mockPropsForTemplate,
  mergeCopyWithDefaults,
} from "./section-props-shared.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { parseLlmJson } from "../llm/parse-json.js";
import {
  normalizeCopyProps,
  padCopyArraysFromDefaults,
} from "../llm/normalize-llm-output.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { writeSectionCopy } from "./copywriter-agent.js";
import { curateSectionMedia } from "./media-curator-agent.js";
import type { MediaRegistry } from "../media/media-registry.js";

const UNIFIED_PROMPT = `You are a section content agent for ONE premium React marketing section (Framer quality).

OUTPUT: JSON props with ALL copy fields AND image/imageQuery fields for this template.
- All string fields must be plain strings, never JSON arrays
- Use imageQuery (never src) — descriptive stock photo queries matching vertical imageHints
- Write specific copy for THIS business — never generic filler or placeholder names
- headline must NOT repeat section intent verbatim
- Avoid: seamless, innovative, world-class, cutting-edge, empower, elevate

Return { "props": { ... } } or a flat props object. Output valid JSON only.`;

export async function fillSectionCopyAndMedia(
  ctx: SiteContext,
  pageSlug: string,
  section: BlueprintSection,
  registry: MediaRegistry
): Promise<{ copy: Record<string, unknown>; media: Record<string, unknown> }> {
  const template = getTemplate(section.templateId);
  if (!template) throw new Error(`Unknown template: ${section.templateId}`);

  const profile = ctx.verticalProfile as VerticalDesignProfile | undefined;
  const defaults = stripMediaFields(
    mockPropsForTemplate(section.templateId, section, ctx.expandedBrief, pageSlug, profile)
  );

  if (!llm.isAvailable) {
    if (!allowMocks()) requireLlm("section unified");
    return { copy: defaults, media: extractMediaFromDefaults(defaults) };
  }

  try {
    const schemaHint = Object.keys(
      COPY_PROP_SCHEMAS[section.templateId as keyof typeof COPY_PROP_SCHEMAS] ?? {}
    );
    const pagePlan = ctx.sitePlan.pages.find((p) => p.slug === pageSlug);
    const raw = await llm.chat(
      UNIFIED_PROMPT,
      `${briefToContext(ctx.expandedBrief)}
PAGE: ${pageSlug} | GOAL: ${pagePlan?.goal ?? "convert"}
SECTION: ${section.id} — ${section.intent}
TEMPLATE: ${section.templateId} (${template.description})
MOOD: ${ctx.designSystem.mood}
Image hints: ${profile?.imageHints ?? "professional stock"}
Fields: ${schemaHint.join(", ")}`,
      { jsonMode: true, temperature: 0.72, tokenRole: "section", model: llm.getSectionModel() }
    );

    const parsed = parseLlmJson<Record<string, unknown>>(raw);
    const payload =
      parsed.props && typeof parsed.props === "object"
        ? (parsed.props as Record<string, unknown>)
        : parsed;

    const copyOnly = stripMediaFields(payload);
    const mediaOnly = extractMediaFields(payload);

    const padded = padCopyArraysFromDefaults(
      mergeCopyWithDefaults(copyOnly, defaults),
      defaults
    );
    const copy = stripMediaFields(validateCopyProps(section.templateId, padded));

    const mediaDefaults = extractMediaFromDefaults(defaults);
    return {
      copy,
      media: { ...mediaDefaults, ...mediaOnly },
    };
  } catch (err) {
    recordFallback("copywriter", section.id);
    pipelineLog(
      `[pipeline] Unified section ${section.id} failed: ${err instanceof Error ? err.message : String(err)} — split agents`
    );
    if (strictLlmRequired()) handleLlmFailure(`unified section ${section.id}`, err);
    const copy = await writeSectionCopy(ctx, pageSlug, section);
    const media = await curateSectionMedia(ctx, pageSlug, section, copy, registry);
    return { copy, media };
  }
}

function stripMediaFields(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  delete out.image;
  delete out.before;
  delete out.after;
  delete out.video;
  delete out.images;
  if (Array.isArray(out.items)) {
    out.items = (out.items as Record<string, unknown>[]).map((item) => {
      const { image, avatar, ...rest } = item;
      return rest;
    });
  }
  if (Array.isArray(out.members)) {
    out.members = (out.members as Record<string, unknown>[]).map((m) => {
      const { image, ...rest } = m;
      return rest;
    });
  }
  return out;
}

function extractMediaFields(props: Record<string, unknown>): Record<string, unknown> {
  const media: Record<string, unknown> = {};
  for (const key of ["image", "before", "after", "video", "images"]) {
    if (props[key]) media[key] = props[key];
  }
  if (Array.isArray(props.items)) {
    media.items = (props.items as Record<string, unknown>[]).map((item) => {
      const out: Record<string, unknown> = {};
      if (item.image) out.image = item.image;
      if (item.avatar) out.avatar = item.avatar;
      return Object.keys(out).length ? out : null;
    }).filter(Boolean);
  }
  if (Array.isArray(props.members)) {
    media.members = (props.members as Record<string, unknown>[]).map((m) =>
      m.image ? { image: m.image } : null
    ).filter(Boolean);
  }
  return media;
}

function extractMediaFromDefaults(props: Record<string, unknown>): Record<string, unknown> {
  return extractMediaFields(props);
}
