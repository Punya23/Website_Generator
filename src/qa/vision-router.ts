import type { QAIssue } from "../types.js";

export interface VisionSectionFix {
  sectionId: string;
  pageSlug: string;
  domain: "copy" | "layout" | "regen";
  suggestion?: string;
}

export interface VisionFixPlan {
  design: boolean;
  motion: boolean;
  chrome: boolean;
  sections: VisionSectionFix[];
}

function matches(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function classifyIssue(issue: QAIssue): keyof VisionFixPlan | "copy" | "layout" | "regen" | null {
  const code = (issue.code ?? "").toUpperCase();
  const msg = `${issue.code ?? ""} ${issue.message ?? ""} ${issue.suggestion ?? ""}`;

  if (code.includes("NAV_CONTRAST") || code.includes("VISUAL_NAV")) return "design";
  if (code.includes("MOTION_MONOTONY") || code.includes("VISUAL_MOTION")) return "motion";
  if (code.includes("GENERIC_TEMPLATE")) return "regen";
  if (code.includes("COPY_WEAK") || code.includes("VISUAL_COPY")) return "copy";
  if (code.includes("SPACING") || code.includes("VISUAL_SPACING") || code.includes("VISUAL_LAYOUT")) {
    return "layout";
  }
  if (code.includes("VISUAL_CHROME") || code.includes("CHROME")) return "chrome";

  if (matches(msg, ["nav", "contrast", "unreadable", "glass", "gradient"])) return "design";
  if (matches(msg, ["motion", "animation", "monotonous", "static", "animate"])) return "motion";
  if (matches(msg, ["generic", "templated", "cookie-cutter", "cookie cutter", "interchangeable", "stock"])) {
    return "regen";
  }
  if (matches(msg, ["footer", "nav link", "chrome"])) return "chrome";
  if (matches(msg, ["headline", "copy", "text", "typo", "weak wording", "illegible text"])) return "copy";
  if (matches(msg, ["spacing", "gap", "cramped", "overflow", "alignment", "misaligned", "crowded"])) {
    return "layout";
  }

  return null;
}

export function routeVisionIssues(issues: QAIssue[], pageSlug: string): VisionFixPlan {
  const plan: VisionFixPlan = {
    design: false,
    motion: false,
    chrome: false,
    sections: [],
  };

  const hard = issues.filter((i) => i.severity === "hard");
  const seenSections = new Set<string>();

  for (const issue of hard) {
    const domain = classifyIssue(issue);
    if (!domain) continue;

    if (domain === "design") plan.design = true;
    else if (domain === "motion") plan.motion = true;
    else if (domain === "chrome") plan.chrome = true;
    else if ((domain === "copy" || domain === "layout" || domain === "regen") && issue.sectionId) {
      const key = `${issue.sectionId}:${domain}`;
      if (!seenSections.has(key)) {
        seenSections.add(key);
        plan.sections.push({
          sectionId: issue.sectionId,
          pageSlug,
          domain,
          suggestion: issue.suggestion,
        });
      }
    } else if (domain === "layout" && !issue.sectionId) {
      plan.design = plan.design || matches(issue.message, ["nav"]);
      if (!plan.design) plan.motion = plan.motion || false;
    }
  }

  return plan;
}

export function visionFixPlanHasWork(plan: VisionFixPlan): boolean {
  return plan.design || plan.motion || plan.chrome || plan.sections.length > 0;
}
