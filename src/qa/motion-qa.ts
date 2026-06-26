import type { PageBlueprint, SiteMotionPlan } from "../types.js";
import type { QAIssue, QAResult } from "../types.js";
import { getTemplate } from "../section-templates/registry.js";

const HERO_TEMPLATES = new Set([
  "hero_editorial",
  "hero_split_cinematic",
  "hero_video",
  "hero_spotlight",
]);

export function runMotionQA(
  plan: SiteMotionPlan,
  blueprints: PageBlueprint[]
): QAResult {
  const issues: QAIssue[] = [];

  for (const bp of blueprints) {
    let run = 0;
    let lastEntrance = "";
    for (const s of bp.sections) {
      const cfg = plan.sections[s.id];
      if (!cfg) {
        issues.push({
          severity: "hard",
          code: "MISSING_SECTION_MOTION",
          message: `No motion config for section ${s.id}`,
          sectionId: s.id,
        });
        continue;
      }

      if (cfg.entrance === lastEntrance) run++;
      else {
        run = 1;
        lastEntrance = cfg.entrance;
      }
      if (run >= 4) {
        issues.push({
          severity: "hard",
          code: "MOTION_MONOTONY",
          message: `4+ consecutive "${cfg.entrance}" entrances on ${bp.slug}`,
          sectionId: s.id,
        });
      }

      if (cfg.parallax && !HERO_TEMPLATES.has(s.templateId)) {
        issues.push({
          severity: "hard",
          code: "PARALLAX_NON_HERO",
          message: `Parallax on non-hero section ${s.id} (${s.templateId})`,
          sectionId: s.id,
        });
      }

      const template = getTemplate(s.templateId);
      if (cfg.marquee && template?.id !== "stats_marquee" && template?.id !== "logo_marquee" && template?.id !== "text_marquee") {
        issues.push({
          severity: "soft",
          code: "MARQUEE_MISMATCH",
          message: `Marquee motion on non-marquee template ${s.templateId}`,
          sectionId: s.id,
        });
      }
    }
  }

  if (!plan.chrome?.footer?.entrance) {
    issues.push({
      severity: "hard",
      code: "MISSING_FOOTER_MOTION",
      message: "Chrome footer motion config missing",
    });
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}
