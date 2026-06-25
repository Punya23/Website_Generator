import type { QAIssue, QAResult, ReactPage } from "../types.js";
import { getTemplate, TEMPLATE_IDS } from "../section-templates/registry.js";

const CARD_HEAVY_TEMPLATES = new Set(["feature_bento", "pricing_tiers", "team_grid"]);

export function runReactQA(page: ReactPage, pageSlug: string): QAResult {
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
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}
