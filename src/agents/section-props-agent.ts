import type { ExpandedBrief, SectionInstance, SiteContext } from "../types.js";
import type { BlueprintSection } from "./page-composer-agent.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { getTemplate, validateTemplateProps } from "../section-templates/registry.js";
import { TEMPLATE_PROP_SCHEMAS } from "../section-templates/schemas.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { MediaRegistry } from "../media/media-registry.js";
import { resolveUniqueImage } from "../media/enrich-content.js";
import { polishSectionProps } from "./polish-section-props.js";
import { sanitizePropsForCodegen } from "../react-codegen/sanitize-props.js";

async function enrichTemplateImages(
  templateId: string,
  props: Record<string, unknown>,
  ctx: SiteContext,
  sectionId: string,
  pageSlug: string,
  registry: MediaRegistry
): Promise<Record<string, unknown>> {
  const out = { ...props };
  const brief = ctx.expandedBrief.expandedBrief;
  const business = ctx.businessName;

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
    const src = await resolveUniqueImage(
      `${brief} ${business} ${q}`,
      `${sectionId}-${key}`,
      registry,
      sectionId,
      sectionId,
      pageSlug,
      1400,
      900
    );
    obj[key] = { ...img, src };
  }

  if (templateId === "hero_editorial" || templateId === "hero_split_cinematic" || templateId === "services_showcase") {
    await enrichImageField(out, "image", String(out.headline ?? business));
  }

  if (templateId === "feature_bento" && Array.isArray(out.items)) {
    const items = [...(out.items as Record<string, unknown>[])];
    for (let i = 0; i < items.length; i++) {
      const item = { ...items[i]! };
      if (item.image) {
        await enrichImageField(item, "image", String(item.title ?? "feature"));
      }
      items[i] = item;
    }
    out.items = items;
  }

  if (templateId === "portfolio_strip" && Array.isArray(out.projects)) {
    const projects = [...(out.projects as Record<string, unknown>[])];
    for (let i = 0; i < projects.length; i++) {
      const p = { ...projects[i]! };
      await enrichImageField(p, "image", String(p.title ?? "project"));
      projects[i] = p;
    }
    out.projects = projects;
  }

  if (templateId === "team_grid" && Array.isArray(out.members)) {
    const members = [...(out.members as Record<string, unknown>[])];
    for (let i = 0; i < members.length; i++) {
      const m = { ...members[i]! };
      await enrichImageField(m, "image", String(m.name ?? "team"));
      members[i] = m;
    }
    out.members = members;
  }

  if (templateId === "gallery_masonry" && Array.isArray(out.images)) {
    const images = [...(out.images as Record<string, unknown>[])];
    for (let i = 0; i < images.length; i++) {
      const img = { ...images[i]! };
      if (!img.src) {
        const src = await resolveUniqueImage(
          `${brief} ${business} gallery`,
          `${sectionId}-img-${i}`,
          registry,
          sectionId,
          sectionId,
          pageSlug,
          1000,
          1200
        );
        images[i] = { ...img, src };
      }
    }
    out.images = images;
  }

  return out;
}

function mockPropsForTemplate(
  templateId: string,
  section: BlueprintSection,
  brief: ExpandedBrief,
  pageSlug: string
): Record<string, unknown> {
  const cta = { label: brief.primaryCta, href: pageSlug === "contact" ? "#" : "/contact" };

  switch (templateId) {
    case "hero_editorial":
      return {
        label: "Welcome",
        headline: brief.businessName,
        subcopy: brief.tagline,
        image: { imageQuery: `${brief.businessName} hero`, alt: brief.businessName },
        cta,
      };
    case "hero_split_cinematic":
      return {
        headline: brief.businessName,
        subcopy: brief.tagline,
        body: brief.elevatorPitch,
        image: { imageQuery: brief.services[0] ?? "studio" },
        cta,
      };
    case "intro_statement":
      return { label: section.intent, headline: section.intent, body: brief.expandedBrief };
    case "stats_marquee":
      return {
        stats: [
          { value: "500+", label: "Happy clients" },
          { value: "98%", label: "Satisfaction" },
          { value: "10+", label: "Years experience" },
        ],
      };
    case "services_showcase":
      return {
        headline: section.intent,
        paragraphs: [brief.elevatorPitch, brief.differentiators.join(". ")],
        image: { imageQuery: section.intent },
        cta,
      };
    case "feature_bento":
      return {
        headline: "What we offer",
        items: brief.services.slice(0, 4).map((s) => ({
          title: s,
          description: `${s} — delivered with care.`,
          span: "normal",
        })),
      };
    case "testimonial_featured":
      return { quote: brief.elevatorPitch, author: "A valued client", role: brief.targetAudience };
    case "cta_band":
      return { headline: brief.primaryCta, subcopy: brief.secondaryCta, cta };
    case "contact_split":
      return {
        headline: "Get in touch",
        subcopy: brief.tagline,
        email: "hello@example.com",
        formFields: [
          { label: "Name", type: "text", required: true },
          { label: "Email", type: "email", required: true },
          { label: "Message", type: "textarea" },
        ],
      };
    case "faq_accordion":
      return {
        headline: "FAQ",
        items: brief.services.slice(0, 3).map((s) => ({
          question: `Do you offer ${s}?`,
          answer: `Yes — ${s} is a core part of our offering.`,
        })),
      };
    case "team_grid":
      return {
        headline: "Our team",
        members: [
          { name: "Alex Morgan", role: "Lead", bio: brief.differentiators[0] },
          { name: "Jordan Lee", role: "Specialist", bio: brief.differentiators[1] },
        ],
      };
    case "gallery_masonry":
      return {
        headline: "Gallery",
        images: brief.services.slice(0, 4).map((s) => ({ imageQuery: s, caption: s })),
      };
    case "portfolio_strip":
      return {
        headline: "Selected work",
        projects: brief.services.slice(0, 3).map((s, i) => ({
          title: s,
          category: brief.businessName,
          year: String(2024 + i),
        })),
      };
    case "pricing_tiers":
      return {
        headline: "Plans",
        tiers: [
          { name: "Starter", price: "$99", period: "mo", features: brief.services.slice(0, 2) },
          { name: "Pro", price: "$299", period: "mo", highlighted: true, features: brief.services },
        ],
      };
    case "logo_marquee":
      return {
        logos: brief.differentiators.map((d) => ({ name: d })),
      };
    default:
      return { headline: section.intent, body: brief.expandedBrief };
  }
}

export async function fillSectionProps(
  ctx: SiteContext,
  pageSlug: string,
  section: BlueprintSection,
  registry: MediaRegistry
): Promise<SectionInstance> {
  requireLlm("section props");
  const template = getTemplate(section.templateId);
  if (!template) throw new Error(`Unknown template: ${section.templateId}`);

  let props: Record<string, unknown>;

  if (llm.isAvailable) {
    const schemaHint = Object.keys(TEMPLATE_PROP_SCHEMAS[section.templateId as keyof typeof TEMPLATE_PROP_SCHEMAS] ?? {});
    const raw = await llm.chat(
      `You fill props for ONE website section template. Output JSON only — props object, no wrapper.

Rules:
- Use imageQuery (not src) for images.
- headline: compelling visitor-facing copy — NEVER copy the section intent verbatim.
- label: optional short tag (2-4 words). Do NOT duplicate headline.
- body/paragraphs: concise, editorial tone. Max 2-3 sentences per paragraph.
- Write for: ${section.intent}
- Template: ${section.templateId} (${template.description})`,
      `${briefToContext(ctx.expandedBrief)}
PAGE: ${pageSlug}
SECTION: ${section.id} — ${section.intent}
MOOD: ${ctx.designSystem.mood}
Avoid: ${ctx.sitePlan.avoidPatterns.join("; ")}`,
      { jsonMode: true, temperature: 0.75, maxTokens: 2048, model: llm.getSectionModel() }
    );
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      props = validateTemplateProps(section.templateId, parsed.props ?? parsed);
    } catch {
      props = mockPropsForTemplate(section.templateId, section, ctx.expandedBrief, pageSlug);
    }
  } else {
    if (!allowMocks()) throw new Error("Section props requires LLM");
    props = mockPropsForTemplate(section.templateId, section, ctx.expandedBrief, pageSlug);
  }

  props = await enrichTemplateImages(section.templateId, props, ctx, section.id, pageSlug, registry);
  props = validateTemplateProps(section.templateId, props);
  props = polishSectionProps(section.templateId, props, section.intent, ctx.expandedBrief);
  props = sanitizePropsForCodegen(props);

  pipelineLog(`[pipeline] ${pageSlug}/${section.id}: props (${section.templateId})`);

  return {
    id: section.id,
    templateId: section.templateId,
    intent: section.intent,
    props,
    fullBleed: template.sectionMode === "bleed" || template.sectionMode === "band",
    motion: template.defaultMotion,
  };
}
