import type { SectionInstance, SiteContext } from "../types.js";
import type { BlueprintSection } from "./page-composer-agent.js";
import { getTemplate } from "../section-templates/registry.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { MediaRegistry } from "../media/media-registry.js";
import { writeSectionCopy } from "./copywriter-agent.js";
import { curateSectionMedia } from "./media-curator-agent.js";
import { fillSectionCopyAndMedia } from "./section-unified-agent.js";
import { useUnifiedSectionLlm } from "../llm/pipeline-speed.js";
import { mergeSectionProps } from "./merge-props.js";
import { layoutSpecToProps } from "./layout-fix-agent.js";
import { attachMotionPlan } from "./contracts/index.js";

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
  let props = mergeSectionProps(
    section.templateId,
    copyProps,
    mediaProps,
    section.intent,
    ctx.expandedBrief
  );

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
