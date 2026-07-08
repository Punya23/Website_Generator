import {
  COMPONENT_MANIFEST,
  CONVERSION_COMPONENT_NAMES,
  HERO_COMPONENT_NAMES,
} from "./component-manifest.js";
import { getTemplateByComponentName } from "../section-templates/registry.js";
import { COPY_PROP_SCHEMAS } from "../section-templates/schemas.js";

export interface PageCodegenSection {
  component: string;
  intent: string;
  props: Record<string, unknown>;
}

export interface PageCodegenPlan {
  sections: PageCodegenSection[];
}

export interface PageCodegenValidateOptions {
  requiredHero?: string;
  avoidComponents?: string[];
}

const KNOWN_COMPONENTS = new Set(COMPONENT_MANIFEST.map((e) => e.componentName));

function isPlaceholderCopy(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return (
    /^feature \d+$/.test(t) ||
    t === "tailored to your needs." ||
    t === "tailored to your needs" ||
    t === "details coming soon." ||
    t === "details coming soon" ||
    t.includes("lorem ipsum") ||
    t === "learn more"
  );
}

function validateComponentCopy(section: PageCodegenSection): string | null {
  const name = section.component;
  const props = section.props;

  if (name === "FeatureBento" && Array.isArray(props.items)) {
    if (props.items.length < 3) {
      return `FeatureBento needs at least 3 items with specific titles and descriptions, got ${props.items.length}`;
    }
    for (let j = 0; j < props.items.length; j++) {
      const item = props.items[j] as Record<string, unknown>;
      const title = String(item.title ?? "");
      const description = String(item.description ?? "");
      if (isPlaceholderCopy(title) || isPlaceholderCopy(description)) {
        return `FeatureBento item ${j + 1} uses placeholder copy — write specific benefits for this business`;
      }
    }
  }

  if (name === "HorizontalGallery" && Array.isArray(props.items)) {
    if (props.items.length < 3) {
      return `HorizontalGallery needs at least 3 items, got ${props.items.length}`;
    }
  }

  return null;
}

/** Validates the whole plan and, for every recognized section, replaces `section.props` in place
 *  with the real Zod-parsed/coerced output (COPY_PROP_SCHEMAS — image/media fields are resolved
 *  later by enrichPropsImages, so they're intentionally not required here). Accumulates every
 *  violation found (not just the first) so one retry round can fix multiple defects at once. */
export function validatePageCodegenPlan(
  plan: PageCodegenPlan,
  pageSlug: string,
  options?: PageCodegenValidateOptions
): string | null {
  if (!Array.isArray(plan.sections) || plan.sections.length === 0) {
    return "sections must be a non-empty array";
  }

  const violations: string[] = [];

  const min = pageSlug === "home" ? 4 : 3;
  const max = pageSlug === "home" ? 7 : 5;
  if (plan.sections.length < min) {
    violations.push(`page needs at least ${min} sections, got ${plan.sections.length}`);
  }
  if (plan.sections.length > max) {
    violations.push(`page has at most ${max} sections, got ${plan.sections.length}`);
  }

  if (pageSlug === "home" && !plan.sections.some((s) => HERO_COMPONENT_NAMES.has(s.component))) {
    violations.push(
      "home page must start with a hero component (HeroSpotlight, HeroEditorial, HeroSplitCinematic, or HeroVideo)"
    );
  }

  const first = plan.sections[0]!;
  if (pageSlug === "home" && !HERO_COMPONENT_NAMES.has(first.component)) {
    violations.push(`home first section must be a hero, got ${first.component}`);
  }

  if (options?.requiredHero && first.component !== options.requiredHero) {
    violations.push(`first section must be ${options.requiredHero}, got ${first.component}`);
  }

  const avoid = new Set(options?.avoidComponents ?? []);

  let conversionCount = 0;
  const seen = new Set<string>();

  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i]!;
    const name = section.component?.trim();
    if (!name || !KNOWN_COMPONENTS.has(name)) {
      violations.push(`unknown component "${section.component}" — use exact names from the manifest`);
      continue;
    }
    if (avoid.has(name)) {
      violations.push(`component "${name}" is banned on this page — choose a different section type`);
    }
    const template = getTemplateByComponentName(name);
    if (!template) {
      violations.push(`component "${name}" is not registered`);
      continue;
    }
    if (!section.props || typeof section.props !== "object" || Array.isArray(section.props)) {
      violations.push(`section ${i} (${name}) props must be an object`);
      continue;
    }
    if (!section.intent?.trim()) {
      violations.push(`section ${i} (${name}) needs a short intent`);
    }

    if (section.props.__intentDerivedHeadline) {
      violations.push(
        `section ${i} (${name}): headline was auto-filled from the planning intent — write real headline copy for this business`
      );
    }

    const copySchema = COPY_PROP_SCHEMAS[template.id];
    const parsed = copySchema.safeParse(section.props);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      violations.push(`section ${i} (${name}) props invalid: ${detail}`);
    } else {
      section.props = parsed.data as Record<string, unknown>;
    }

    const copyError = validateComponentCopy(section);
    if (copyError) {
      violations.push(`section ${i} (${name}): ${copyError}`);
    }

    if (CONVERSION_COMPONENT_NAMES.has(name)) {
      conversionCount++;
      if (seen.has(name)) {
        violations.push(`duplicate conversion section "${name}" — only one closer allowed`);
      }
    }
    seen.add(name);
  }

  if (conversionCount > 1) {
    violations.push("at most one conversion section per page (CtaBand, FooterCta, or NewsletterBand)");
  }

  return violations.length > 0 ? violations.join("; ") : null;
}

export function parsePageCodegenPlan(raw: unknown): PageCodegenPlan {
  const data = raw as { sections?: Array<{ component?: string; intent?: string; props?: unknown }> };
  if (!data?.sections) {
    throw new Error("Missing sections array");
  }
  return {
    sections: data.sections.map((s, i) => ({
      component: String(s.component ?? "").trim(),
      intent: String(s.intent ?? `Section ${i}`).trim(),
      props: (s.props && typeof s.props === "object" && !Array.isArray(s.props)
        ? s.props
        : {}) as Record<string, unknown>,
    })),
  };
}
