import type { SectionInstance, SiteContext } from "../types.js";
import type { BlueprintSection } from "./page-composer-agent.js";
import { getTemplate } from "../section-templates/registry.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { MediaRegistry } from "../media/media-registry.js";
import { writeSectionCopy } from "./copywriter-agent.js";
import { curateSectionMedia, extractMediaFromMock } from "./media-curator-agent.js";
import { fillSectionCopyAndMedia } from "./section-unified-agent.js";
import { useUnifiedSectionLlm } from "../llm/pipeline-speed.js";
import { mergeSectionProps } from "./merge-props.js";
import { layoutSpecToProps } from "./layout-fix-agent.js";
import { attachMotionPlan } from "./contracts/index.js";
import { mockPropsForTemplate } from "./section-props-shared.js";
import { strictLlmRequired, handleLlmFailure } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { ZodError } from "zod";
import type { VerticalDesignProfile } from "../design/vertical-profiles.js";

/** Prop-name fragments that identify a Zod issue as media-shaped rather than copy-shaped —
 *  used to decide which upstream agent is worth re-running on a validation failure. */
const MEDIA_FIELD_NAMES = new Set([
  "image",
  "images",
  "video",
  "logo",
  "logos",
  "avatar",
  "poster",
  "before",
  "after",
  "src",
]);

function zodIssuePaths(err: unknown): (string | number)[][] {
  return err instanceof ZodError ? err.issues.map((issue) => issue.path) : [];
}

/** Which upstream step is most likely to fix the failure if re-run. A non-Zod error (e.g.
 *  thrown from polishSectionProps/sanitizePropsForCodegen rather than schema.parse) has no
 *  path information, so the safe default is to redo both. */
function classifyValidationFailure(err: unknown): "media" | "copy" | "both" {
  const paths = zodIssuePaths(err);
  if (paths.length === 0) return "both";
  let touchesMedia = false;
  let touchesCopy = false;
  for (const path of paths) {
    if (path.some((seg) => typeof seg === "string" && MEDIA_FIELD_NAMES.has(seg))) {
      touchesMedia = true;
    } else {
      touchesCopy = true;
    }
  }
  if (touchesMedia && touchesCopy) return "both";
  return touchesMedia ? "media" : "copy";
}

function describeValidationError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

/** Deterministic, business-aware props that satisfy the template schema — reuses the same
 *  mock generator copywriter-agent.ts/media-curator-agent.ts already fall back to when their
 *  own LLM calls fail, and routes the mock media through curateSectionMedia's prefillMedia
 *  path so images still resolve a real `src` instead of shipping a bare imageQuery. This is
 *  the final safety net: it must never throw for a well-formed templateId, since repairTemplateProps
 *  (invoked inside mergeSectionProps -> validateTemplateProps) is expected to patch any
 *  remaining shape gaps (e.g. padding array minimums) before the schema.parse() call. */
async function minimalValidInstanceProps(
  ctx: SiteContext,
  pageSlug: string,
  section: BlueprintSection,
  registry: MediaRegistry
): Promise<Record<string, unknown>> {
  const profile = ctx.verticalProfile as VerticalDesignProfile | undefined;
  const mock = mockPropsForTemplate(section.templateId, section, ctx.expandedBrief, pageSlug, profile);
  const mediaSeed = extractMediaFromMock(section, ctx, pageSlug);
  const copyProps = { ...mock };
  for (const key of Object.keys(mediaSeed)) delete copyProps[key];

  const mediaProps = await curateSectionMedia(ctx, pageSlug, section, copyProps, registry, mediaSeed);
  return mergeSectionProps(section.templateId, copyProps, mediaProps, section.intent, ctx.expandedBrief);
}

/** Orchestrates copywriter + media curator + merge. */
export async function fillSectionProps(
  ctx: SiteContext,
  pageSlug: string,
  section: BlueprintSection,
  registry: MediaRegistry
): Promise<SectionInstance> {
  const template = getTemplate(section.templateId);
  if (!template) throw new Error(`Unknown template: ${section.templateId}`);

  let copyProps: Record<string, unknown>;
  let mediaProps: Record<string, unknown>;

  if (useUnifiedSectionLlm()) {
    const unified = await fillSectionCopyAndMedia(ctx, pageSlug, section, registry);
    copyProps = unified.copy;
    mediaProps = await curateSectionMedia(
      ctx,
      pageSlug,
      section,
      copyProps,
      registry,
      unified.media
    );
  } else {
    copyProps = await writeSectionCopy(ctx, pageSlug, section);
    mediaProps = await curateSectionMedia(ctx, pageSlug, section, copyProps, registry);
  }

  let props: Record<string, unknown>;
  try {
    props = mergeSectionProps(section.templateId, copyProps, mediaProps, section.intent, ctx.expandedBrief);
  } catch (mergeErr) {
    const validationMsg = describeValidationError(mergeErr);
    pipelineLog(
      `[pipeline] ${pageSlug}/${section.id}: props failed validation (${section.templateId}) — ${validationMsg}`
    );

    try {
      const failureSite = classifyValidationFailure(mergeErr);
      let retryCopy = copyProps;
      let retryMedia = mediaProps;

      if (failureSite === "copy" || failureSite === "both") {
        retryCopy = await writeSectionCopy(ctx, pageSlug, section, validationMsg);
      }
      if (failureSite === "media" || failureSite === "both") {
        retryMedia = await curateSectionMedia(
          ctx,
          pageSlug,
          section,
          retryCopy,
          registry,
          undefined,
          validationMsg
        );
      }

      props = mergeSectionProps(section.templateId, retryCopy, retryMedia, section.intent, ctx.expandedBrief);
      pipelineLog(`[pipeline] ${pageSlug}/${section.id}: recovered props on retry (${section.templateId})`);
    } catch (retryErr) {
      recordFallback("section_props", section.id);

      if (strictLlmRequired()) {
        handleLlmFailure(`section props ${pageSlug}/${section.id}`, retryErr);
      }

      pipelineLog(
        `[pipeline] ${pageSlug}/${section.id}: retry also failed (${
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        }) — degrading to minimal valid props (${section.templateId})`
      );

      try {
        props = await minimalValidInstanceProps(ctx, pageSlug, section, registry);
      } catch (fallbackErr) {
        // mockPropsForTemplate + repairTemplateProps couldn't satisfy this template's schema
        // either — that's a real code defect (missing repair-props.ts coverage), not a
        // transient LLM issue. Fail loudly and specifically rather than emit props that
        // won't actually pass the schema.
        throw new Error(
          `fillSectionProps: no valid props could be produced for ${section.templateId} ` +
            `(${pageSlug}/${section.id}) even via mock fallback — add/extend a repairTemplateProps ` +
            `case for this template. Original: ${validationMsg}. Fallback: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            }`,
          { cause: fallbackErr }
        );
      }
    }
  }

  const layoutSpec = ctx.layoutPlan?.sections[section.id];
  if (layoutSpec) {
    props = { ...props, ...layoutSpecToProps(layoutSpec) };
  }

  pipelineLog(`[pipeline] ${pageSlug}/${section.id}: props (${section.templateId})`);

  const instance: SectionInstance = {
    id: section.id,
    templateId: section.templateId,
    intent: section.intent,
    props,
    fullBleed: template.sectionMode === "bleed" || template.sectionMode === "band",
    motion: template.defaultMotion,
    layoutSpec,
  };

  if (ctx.motionPlan) {
    const [withMotion] = attachMotionPlan([instance], ctx.motionPlan);
    return withMotion!;
  }

  return instance;
}
