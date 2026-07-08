/** Light prop normalization for page-codegen LLM output — structure only, no copy rewriting. */
import { getTemplateByComponentName } from "../section-templates/registry.js";
import { repairTemplateProps } from "../section-templates/repair-props.js";
import { COPY_PROP_SCHEMAS } from "../section-templates/schemas.js";
import type { PageCodegenPlan } from "./page-codegen-validate.js";

/** Whether this template's own schema actually has the given top-level field — avoids inventing
 *  props (like a "headline" on TestimonialFeatured, which has none) that the component never reads. */
function templateHasField(templateId: string, field: string): boolean {
  const schema = COPY_PROP_SCHEMAS[templateId as keyof typeof COPY_PROP_SCHEMAS] as unknown as
    | { shape?: Record<string, unknown> }
    | undefined;
  return Boolean(schema?.shape && field in schema.shape);
}

export function normalizePageCodegenPlan(plan: PageCodegenPlan): PageCodegenPlan {
  return {
    sections: plan.sections.map((section) => {
      const template = getTemplateByComponentName(section.component);
      if (!template) return section;
      return {
        ...section,
        props: normalizePageCodegenProps(template.id, section.props, section.intent),
      };
    }),
  };
}

/** Trim over-long plans and coalesce missing fields before validation. */
export function preparePageCodegenPlan(plan: PageCodegenPlan, pageSlug: string): PageCodegenPlan {
  return trimPageCodegenPlan(normalizePageCodegenPlan(plan), pageSlug);
}

export function trimPageCodegenPlan(plan: PageCodegenPlan, pageSlug: string): PageCodegenPlan {
  const max = pageSlug === "home" ? 7 : 5;
  if (plan.sections.length <= max) return plan;

  const sections = [...plan.sections];
  while (sections.length > max) {
    let dropAt = 1;
    while (
      dropAt < sections.length - 1 &&
      ["CtaBand", "FooterCta", "NewsletterBand"].includes(sections[dropAt]!.component)
    ) {
      dropAt++;
    }
    if (dropAt >= sections.length - 1) dropAt = Math.max(1, sections.length - 2);
    sections.splice(dropAt, 1);
  }
  return { ...plan, sections };
}

function nonEmptyString(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const t = val.trim();
  return t.length > 0 ? t : undefined;
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    const s = nonEmptyString(v);
    if (s) return s;
  }
  return undefined;
}

function coalesceCommonProps(props: Record<string, unknown>, templateId: string, intent?: string): void {
  if (templateHasField(templateId, "headline") && !nonEmptyString(props.headline)) {
    const named = pickString(props.title, props.label, props.heading, props.name);
    if (named) {
      props.headline = named;
    } else if (intent && intent.trim().length >= 8) {
      // Last resort only — the planning intent is an internal one-line note, not visitor-facing
      // copy. Flag it so validatePageCodegenPlan forces a real rewrite instead of silently
      // shipping "Bold opening for the brand" as the section's actual headline.
      props.headline = intent.slice(0, 100);
      props.__intentDerivedHeadline = true;
    }
  }
  if (!nonEmptyString(props.body)) {
    const body = pickString(props.subcopy, props.description, props.text, props.content);
    if (body) props.body = body;
  }
  if (!nonEmptyString(props.quote)) {
    const quote = pickString(props.text, props.body, props.testimonial);
    if (quote) props.quote = quote;
  }
  if (!nonEmptyString(props.author)) {
    const author = pickString(props.name, props.client, props.customer);
    if (author) props.author = author;
  }
}

export function normalizePageCodegenProps(
  templateId: string,
  props: Record<string, unknown>,
  intent?: string
): Record<string, unknown> {
  let out = { ...props };
  coalesceCommonProps(out, templateId, intent);

  if (templateId === "stats_marquee" || templateId === "stats_animated") {
    out.stats = normalizeStatItems(out.stats);
  }

  if (templateId === "feature_bento" && Array.isArray(out.items)) {
    out.items = out.items.map((item) => normalizeFeatureItem(item));
  }

  if (templateId === "faq_accordion" && Array.isArray(out.items)) {
    out.items = out.items.map((item) => normalizeFaqItem(item));
  }

  if (templateId === "services_showcase") {
    out = normalizeServicesShowcase(out);
  }

  if (templateId === "contact_split") {
    out = normalizeContactSplit(out);
  }

  if (templateId === "portfolio_carousel") {
    out = normalizePortfolioCarousel(out);
  }

  if (templateId === "portfolio_strip") {
    out = normalizePortfolioStrip(out);
  }

  if (templateId === "team_grid" && Array.isArray(out.members)) {
    out.members = out.members.map((m) => normalizeTeamMember(m));
  }

  if (templateId === "testimonial_carousel" && Array.isArray(out.items)) {
    out.items = out.items.map((item) => normalizeTestimonialItem(item));
  }

  if (templateId === "testimonial_featured") {
    out = normalizeTestimonialFeatured(out);
  }

  if (templateId === "scroll_showcase" && out.steps !== undefined) {
    out.steps = Array.isArray(out.steps) ? out.steps.map((step) => normalizeScrollStep(step)) : undefined;
  }

  if (templateId === "horizontal_gallery" && Array.isArray(out.items)) {
    out.items = out.items.map((item) => normalizeGalleryItem(item));
  }

  out.cta = coerceCtaField(out.cta);
  if (out.secondaryCta !== undefined) out.secondaryCta = coerceCtaField(out.secondaryCta);

  if (templateId === "hero_video" && out.video !== undefined) {
    if (!out.video || typeof out.video !== "object" || Array.isArray(out.video)) {
      delete out.video;
    }
  }

  if (templateId === "contact_split" && out.formFields !== undefined && !Array.isArray(out.formFields)) {
    delete out.formFields;
  }

  if (templateId === "text_marquee" && out.speed !== undefined) {
    const validSpeeds = new Set(["slow", "normal", "fast"]);
    if (!validSpeeds.has(String(out.speed))) delete out.speed;
  }

  return repairTemplateProps(templateId, out);
}

/** LLMs sometimes return a CTA as a bare string ("Book a table") instead of { label, href }. */
function coerceCtaField(val: unknown): Record<string, unknown> | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") {
    const label = val.trim();
    return label ? normalizeCta({ label }) : undefined;
  }
  if (typeof val === "object" && !Array.isArray(val)) {
    return normalizeCta(val as Record<string, unknown>);
  }
  return undefined;
}

function normalizeStatItems(raw: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const value = String(row.value ?? row.number ?? row.stat ?? row.count ?? "").trim();
      const label = String(row.label ?? row.name ?? row.title ?? "").trim();
      if (!value || !label) return null;
      return { value, label };
    })
    .filter((x): x is { value: string; label: string } => Boolean(x));
}

function normalizeFeatureItem(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return { title: "", description: "" };
  const row = item as Record<string, unknown>;
  return {
    ...row,
    title: String(row.title ?? row.name ?? row.headline ?? "").trim(),
    description: String(row.description ?? row.body ?? row.subcopy ?? row.text ?? "").trim(),
  };
}

function normalizeFaqItem(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return { question: "", answer: "" };
  const row = item as Record<string, unknown>;
  return {
    ...row,
    question: String(row.question ?? row.q ?? row.title ?? "").trim(),
    answer: String(row.answer ?? row.a ?? row.body ?? row.text ?? "").trim(),
  };
}

function normalizeServicesShowcase(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  if (Array.isArray(out.paragraphs) && out.paragraphs.length > 0) return out;

  const services = out.services;
  if (Array.isArray(services)) {
    out.paragraphs = services
      .map((s) => {
        if (typeof s === "string") return s.trim();
        if (!s || typeof s !== "object") return null;
        const row = s as Record<string, unknown>;
        const title = String(row.title ?? row.name ?? "").trim();
        const desc = String(row.description ?? row.body ?? row.text ?? "").trim();
        if (title && desc) return `${title} — ${desc}`;
        return desc || title || null;
      })
      .filter((p): p is string => Boolean(p))
      .slice(0, 3);
  }

  if (!Array.isArray(out.paragraphs) || out.paragraphs.length === 0) {
    const fallback = out.subcopy ?? out.body ?? out.description;
    if (typeof fallback === "string" && fallback.trim()) {
      out.paragraphs = [fallback.trim()];
    }
  }

  return out;
}

function normalizeContactSplit(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  const info = out.contactInfo;
  if (info && typeof info === "object" && !Array.isArray(info)) {
    const c = info as Record<string, unknown>;
    out.email = out.email ?? c.email;
    out.phone = out.phone ?? c.phone;
    out.address = out.address ?? c.address;
    out.hours = out.hours ?? c.hours;
    delete out.contactInfo;
  }

  if (Array.isArray(out.formFields)) {
    out.formFields = out.formFields.map((field) => {
      if (typeof field === "string") {
        const label = field.trim();
        const lower = label.toLowerCase();
        let type: "text" | "email" | "tel" | "textarea" | "select" = "text";
        if (lower.includes("email")) type = "email";
        else if (lower.includes("phone") || lower.includes("tel")) type = "tel";
        else if (
          lower.includes("message") ||
          lower.includes("detail") ||
          lower.includes("goal") ||
          lower.includes("vision") ||
          lower.includes("description")
        ) {
          type = "textarea";
        }
        return { label, type, required: true };
      }
      if (field && typeof field === "object") {
        const row = field as Record<string, unknown>;
        const label = String(row.label ?? row.name ?? "Field").trim();
        const rawType = String(row.type ?? "text").toLowerCase();
        const type =
          rawType === "email" ||
          rawType === "tel" ||
          rawType === "textarea" ||
          rawType === "select"
            ? rawType
            : "text";
        return { label, type, required: row.required !== false };
      }
      return { label: "Message", type: "textarea" as const, required: true };
    });
  }

  return out;
}

function normalizePortfolioCarousel(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  let raw = out.slides;
  if (!Array.isArray(raw) || raw.length === 0) {
    raw = out.projects ?? out.items ?? out.images;
  }
  if (Array.isArray(raw)) {
    out.slides = raw
      .map((slide) => {
        if (typeof slide === "string") {
          return { title: slide.trim() };
        }
        if (!slide || typeof slide !== "object") return null;
        const row = slide as Record<string, unknown>;
        const title = String(row.title ?? row.name ?? row.headline ?? "").trim();
        if (!title) return null;
        return {
          title,
          category: row.category
            ? String(row.category)
            : row.subtitle
              ? String(row.subtitle)
              : undefined,
          image: row.image,
        };
      })
      .filter((x): x is { title: string; category?: string; image?: unknown } => Boolean(x));
  }
  delete out.projects;
  return out;
}

function normalizePortfolioStrip(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  let raw = out.projects;
  if (!Array.isArray(raw) || raw.length === 0) {
    raw = out.slides ?? out.items;
  }
  if (Array.isArray(raw)) {
    out.projects = raw
      .map((project) => {
        if (typeof project === "string") return { title: project.trim() };
        if (!project || typeof project !== "object") return null;
        const row = project as Record<string, unknown>;
        const title = String(row.title ?? row.name ?? "").trim();
        if (!title) return null;
        return {
          title,
          subtitle: row.subtitle ? String(row.subtitle) : undefined,
          image: row.image,
        };
      })
      .filter((x): x is { title: string; subtitle?: string; image?: unknown } => Boolean(x));
  }
  return out;
}

function normalizeTeamMember(member: unknown): Record<string, unknown> {
  if (!member || typeof member !== "object") return { name: "", role: "" };
  const row = member as Record<string, unknown>;
  return {
    ...row,
    name: String(row.name ?? row.title ?? "").trim(),
    role: String(row.role ?? row.title ?? row.position ?? "").trim(),
    bio: row.bio ? String(row.bio) : undefined,
  };
}

function normalizeTestimonialItem(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return { quote: "", author: "" };
  const row = item as Record<string, unknown>;
  return {
    ...row,
    quote: String(row.quote ?? row.text ?? row.body ?? "").trim(),
    author: String(row.author ?? row.name ?? "").trim(),
    role: row.role ? String(row.role) : undefined,
  };
}

function normalizeTestimonialFeatured(props: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  if (!out.quote && out.text) out.quote = out.text;
  if (!out.author && out.name) out.author = out.name;
  if (!out.role && out.title) out.role = out.title;
  delete out.title;
  delete out.image;
  return out;
}

function normalizeScrollStep(step: unknown): Record<string, unknown> {
  if (!step || typeof step !== "object") return { title: "", description: "" };
  const row = step as Record<string, unknown>;
  return {
    ...row,
    title: String(row.title ?? row.headline ?? row.name ?? "").trim(),
    description: String(row.description ?? row.body ?? row.text ?? "").trim(),
  };
}

function normalizeGalleryItem(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return { title: "" };
  const row = item as Record<string, unknown>;
  return {
    ...row,
    title: String(row.title ?? row.name ?? row.caption ?? "").trim(),
    subtitle: row.subtitle ? String(row.subtitle) : undefined,
  };
}

function normalizeCta(cta: Record<string, unknown>): Record<string, unknown> {
  return {
    ...cta,
    label: String(cta.label ?? cta.text ?? cta.title ?? "Contact").trim(),
    href: String(cta.href ?? cta.url ?? "/contact").trim(),
  };
}
