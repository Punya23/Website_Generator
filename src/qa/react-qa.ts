import { runDesignTokenQA } from "../theme/contrast.js";
import type { SiteTheme, QAIssue, QAResult, ReactPage } from "../types.js";
import { getTemplate, TEMPLATE_IDS } from "../section-templates/registry.js";
import { HOME_SECTION_BUDGET } from "../design/blueprint-trim.js";

const CARD_HEAVY_TEMPLATES = new Set(["feature_bento", "pricing_tiers", "team_grid"]);
const CONVERSION_CLOSERS = new Set(["cta_band", "footer_cta"]);
const CAROUSEL_TEMPLATES = new Set([
  "testimonial_carousel",
  "portfolio_carousel",
  "logo_marquee",
]);

const PREMIUM_TEMPLATES = new Set(["hero_spotlight", "scroll_showcase", "horizontal_gallery"]);
const MOTION_HEAVY_TEMPLATES = new Set([
  "hero_spotlight",
  "scroll_showcase",
  "horizontal_gallery",
  "text_marquee",
  "stats_marquee",
  "hero_video",
]);

const PLACEHOLDER_COPY = [
  "hello@example.com",
  "500+ Happy clients",
  "Alex Morgan",
  "Jordan Lee",
  "A valued client",
];

export function runCopyQA(props: Record<string, unknown>, briefText: string): QAIssue[] {
  const issues: QAIssue[] = [];
  const raw = JSON.stringify(props).toLowerCase();
  const briefLower = briefText.toLowerCase();
  for (const phrase of PLACEHOLDER_COPY) {
    if (raw.includes(phrase.toLowerCase()) && !briefLower.includes(phrase.toLowerCase())) {
      issues.push({
        severity: "hard",
        code: "PLACEHOLDER_COPY",
        message: `Placeholder copy detected: "${phrase}"`,
      });
    }
  }
  return issues;
}

function collectEmptyAlts(props: Record<string, unknown>, sectionId: string): QAIssue[] {
  const issues: QAIssue[] = [];
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if ("src" in obj && typeof obj.src === "string") {
      const alt = obj.alt;
      if (!alt || (typeof alt === "string" && !alt.trim())) {
        issues.push({
          severity: "hard",
          code: "EMPTY_IMAGE_ALT",
          message: `Missing alt text at ${path}`,
          sectionId,
        });
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) v.forEach((item, i) => visit(item, `${path}.${k}[${i}]`));
      else if (v && typeof v === "object") visit(v, `${path}.${k}`);
    }
  };
  visit(props, "props");
  return issues;
}

export function runReactQA(page: ReactPage, pageSlug: string, briefText = ""): QAResult {
  const issues: QAIssue[] = [];

  if (page.sections.length < 2) {
    issues.push({
      severity: "hard",
      code: "TOO_FEW_SECTIONS",
      message: `Page ${pageSlug} has fewer than 2 sections`,
    });
  }

  const unknown = page.sections.filter((s) => !TEMPLATE_IDS.includes(s.templateId as (typeof TEMPLATE_IDS)[number]));
  for (const s of unknown) {
    issues.push({
      severity: "hard",
      code: "UNKNOWN_TEMPLATE",
      message: `Unknown template ${s.templateId} on ${s.id}`,
      sectionId: s.id,
    });
  }

  const cardRatio =
    page.sections.filter((s) => CARD_HEAVY_TEMPLATES.has(s.templateId)).length / page.sections.length;
  if (cardRatio > 0.6) {
    issues.push({
      severity: "soft",
      code: "CARD_HEAVY_PAGE",
      message: `Page ${pageSlug} is ${Math.round(cardRatio * 100)}% card-heavy templates`,
      metric: cardRatio,
    });
  }

  const hasBleed = page.sections.some((s) => {
    const t = getTemplate(s.templateId);
    return t?.sectionMode === "bleed" || t?.sectionMode === "band";
  });
  if (!hasBleed && pageSlug === "home") {
    issues.push({
      severity: "soft",
      code: "NO_BLEED_SECTION",
      message: `Home page lacks bleed/band sections`,
    });
  }

  let run = 0;
  let last = "";
  for (const s of page.sections) {
    if (s.templateId === last) run++;
    else {
      run = 1;
      last = s.templateId;
    }
    if (run >= 4) {
      issues.push({
        severity: "soft",
        code: "MONOTONOUS_RHYTHM",
        message: `Template ${s.templateId} repeated ${run} times in a row`,
        sectionId: s.id,
      });
    }
  }

  for (const s of page.sections) {
    const raw = JSON.stringify(s.props);
    if (raw.includes('"type":') && raw.includes('"id":')) {
      issues.push({
        severity: "hard",
        code: "RAW_JSON_PROPS",
        message: `Section ${s.id} props look like raw block JSON`,
        sectionId: s.id,
      });
    }
    issues.push(...collectEmptyAlts(s.props, s.id));
    issues.push(...runCopyQA(s.props, briefText));
  }

  if (pageSlug === "home") {
    const premiumCount = page.sections.filter((s) => PREMIUM_TEMPLATES.has(s.templateId)).length;
    if (premiumCount === 0) {
      issues.push({
        severity: "soft",
        code: "NO_PREMIUM_SECTION",
        message: "Home page has no immersive premium sections",
      });
    }

    const count = page.sections.length;
    if (count < HOME_SECTION_BUDGET.min || count > HOME_SECTION_BUDGET.max) {
      issues.push({
        severity: "soft",
        code: "HOME_SECTION_BUDGET",
        message: `Home has ${count} sections (target ${HOME_SECTION_BUDGET.min}–${HOME_SECTION_BUDGET.max})`,
      });
    }
  }

  const conversionClosers = page.sections.filter((s) => CONVERSION_CLOSERS.has(s.templateId));
  if (conversionClosers.length > 1) {
    issues.push({
      severity: "hard",
      code: "DUPLICATE_CTA_CLOSER",
      message: `${pageSlug} has ${conversionClosers.length} CTA closers`,
    });
  }

  const carouselTypes = page.sections.filter((s) => CAROUSEL_TEMPLATES.has(s.templateId));
  if (carouselTypes.length > 1) {
    issues.push({
      severity: "soft",
      code: "CAROUSEL_MONOTONY",
      message: `${pageSlug} has ${carouselTypes.length} carousel-type sections`,
    });
  }

  const headlines = page.sections
    .map((s) => {
      const h = s.props.headline;
      return typeof h === "string" ? h.trim().toLowerCase() : "";
    })
    .filter(Boolean);
  const headlineCounts = new Map<string, number>();
  for (const h of headlines) headlineCounts.set(h, (headlineCounts.get(h) ?? 0) + 1);
  for (const [h, n] of headlineCounts) {
    if (n >= 3) {
      issues.push({
        severity: "soft",
        code: "DUPLICATE_HEADLINES",
        message: `Headline "${h}" repeated ${n} times on ${pageSlug}`,
      });
    }
  }

  const ctaLabels = page.sections
    .map((s) => {
      const cta = s.props.cta as { label?: string } | undefined;
      return cta?.label?.trim().toLowerCase() ?? "";
    })
    .filter(Boolean);
  const ctaCounts = new Map<string, number>();
  for (const c of ctaLabels) ctaCounts.set(c, (ctaCounts.get(c) ?? 0) + 1);
  for (const [c, n] of ctaCounts) {
    if (n >= 3) {
      issues.push({
        severity: "soft",
        code: "DUPLICATE_CTA_LABELS",
        message: `CTA label "${c}" repeated ${n} times on ${pageSlug}`,
      });
    }
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}

export function runDesignQA(theme: SiteTheme): QAResult {
  const tokenQa = runDesignTokenQA(theme);
  const issues: QAIssue[] = tokenQa.issues.map((i) => ({
    severity: i.severity,
    code: i.code,
    message: i.message,
  }));
  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}
