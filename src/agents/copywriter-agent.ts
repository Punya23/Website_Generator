/** Copywriter — headlines, body copy, and CTAs for one section template. */
import type { SiteContext } from "../types.js";
import type { BlueprintSection } from "./page-composer-agent.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { getTemplate, validateCopyProps } from "../section-templates/registry.js";
import { COPY_PROP_SCHEMAS } from "../section-templates/schemas.js";
import { freezeSnapshot, type SectionCopySnapshot } from "./contracts/index.js";
import { mockPropsForTemplate, mergeCopyWithDefaults } from "./section-props-shared.js";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { padCopyArraysFromDefaults } from "../llm/normalize-llm-output.js";
import { recordFallback } from "../util/fallback-tracker.js";

const COPY_PROMPT = `You are an editorial copywriter for ONE website section.

INPUT (read-only): brief, section intent, template type, mood.
OUTPUT (your only job): JSON props object with copy fields only.
FORBIDDEN: Do not output imageQuery, src, colors, or layout fields.

Rules:
- All string fields must be plain strings, never JSON arrays
- headline: compelling visitor-facing copy — NEVER copy section intent verbatim
- label: optional short tag (2-4 words), do not duplicate headline
- body/paragraphs/subcopy: concise editorial tone, max 2-3 sentences each
- cta: { label, href } when template needs CTA
- For image templates: omit image field entirely (media agent handles images)

Required shapes (include ALL required fields for the template):
- text_marquee: { "phrases": ["phrase one", "phrase two", "phrase three"] }
- team_grid: { "headline": "...", "members": [{ "name": "...", "role": "...", "bio": "..." }] }
- faq_accordion: { "headline": "...", "items": [{ "question": "...", "answer": "..." }] }
- services_showcase: { "headline": "...", "paragraphs": ["...", "..."] }
- testimonial_featured: { "quote": "...", "author": "...", "role": "..." }
- stats_marquee: { "stats": [{ "value": "...", "label": "..." }] }
- feature_bento: { "headline": "...", "items": [{ "title": "...", "description": "..." }] }`;

export async function writeSectionCopy(
  ctx: SiteContext,
  pageSlug: string,
  section: BlueprintSection
): Promise<Record<string, unknown>> {
  const template = getTemplate(section.templateId);
  if (!template) throw new Error(`Unknown template: ${section.templateId}`);

  const snapshot = freezeSnapshot<SectionCopySnapshot>({
    businessName: ctx.businessName,
    brief: ctx.expandedBrief,
    pageSlug,
    section: { id: section.id, templateId: section.templateId, intent: section.intent },
    designMood: ctx.designSystem.mood,
    avoidPatterns: ctx.sitePlan.avoidPatterns,
    verticalProfile: ctx.verticalProfile,
    variationSeed: ctx.variationSeed,
  });

  if (llm.isAvailable) {
    try {
      const schemaHint = Object.keys(
        COPY_PROP_SCHEMAS[section.templateId as keyof typeof COPY_PROP_SCHEMAS] ?? {}
      );
      const profile = ctx.verticalProfile as VerticalDesignProfile | undefined;
      const profileHints = profile
        ? `Copy voice: ${profile.copyHints}
CTA verbs: ${profile.ctaPatterns.join(", ")}
Proof style: ${profile.proofPatterns.join(", ")}
Page tone: ${profile.pageTone}`
        : "";
      const pagePlan = ctx.sitePlan.pages.find((p) => p.slug === pageSlug);
      const raw = await llm.chat(
        COPY_PROMPT,
        `${briefToContext(snapshot.brief)}
PAGE: ${snapshot.pageSlug}
PAGE GOAL: ${pagePlan?.goal ?? "convert visitors"}
CONTENT FOCUS: ${pagePlan?.contentFocus?.join(", ") ?? "general"}
SECTION: ${snapshot.section.id} — ${snapshot.section.intent}
TEMPLATE: ${snapshot.section.templateId} (${template.description})
MOOD: ${snapshot.designMood}
Vertical profile: ${ctx.verticalProfile?.profileId ?? "generic"}
${profileHints}
Variation seed: ${ctx.variationSeed ?? "none"}
Copy fields only: ${schemaHint.join(", ")}
Avoid: ${snapshot.avoidPatterns.join("; ")}`,
        { jsonMode: true, temperature: 0.75, tokenRole: "section", model: llm.getSectionModel() }
      );
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const payload =
        parsed.props && typeof parsed.props === "object"
          ? (parsed.props as Record<string, unknown>)
          : parsed;
      const defaults = stripMediaFields(
        mockPropsForTemplate(
          section.templateId,
          section,
          ctx.expandedBrief,
          pageSlug,
          profile
        )
      );
      const merged = padCopyArraysFromDefaults(
        mergeCopyWithDefaults(payload, defaults),
        defaults
      );
      return stripMediaFields(validateCopyProps(section.templateId, merged));
    } catch (err) {
      recordFallback("copywriter", section.id);
      pipelineLog(
        `[pipeline] Copywriter ${section.id} failed: ${err instanceof Error ? err.message : String(err)} — using mock copy`
      );
      if (!allowMocks()) {
        const mock = stripMediaFields(
          mockPropsForTemplate(
            section.templateId,
            section,
            ctx.expandedBrief,
            pageSlug,
            ctx.verticalProfile as VerticalDesignProfile | undefined
          )
        );
        try {
          return validateCopyProps(section.templateId, mock);
        } catch {
          throw new Error(
            `Copywriter failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  } else {
    if (!allowMocks()) requireLlm("copywriter");
  }

  return stripMediaFields(
    mockPropsForTemplate(
      section.templateId,
      section,
      ctx.expandedBrief,
      pageSlug,
      ctx.verticalProfile as VerticalDesignProfile | undefined
    )
  );
}

function stripMediaFields(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  delete out.image;
  if (Array.isArray(out.items)) {
    out.items = (out.items as Record<string, unknown>[]).map((item) => {
      const { image, ...rest } = item;
      return rest;
    });
  }
  if (Array.isArray(out.members)) {
    out.members = (out.members as Record<string, unknown>[]).map((m) => {
      const { image, ...rest } = m;
      return rest;
    });
  }
  if (Array.isArray(out.projects)) {
    out.projects = (out.projects as Record<string, unknown>[]).map((p) => {
      const { image, ...rest } = p;
      return rest;
    });
  }
  if (Array.isArray(out.images)) {
    delete out.images;
  }
  return out;
}
