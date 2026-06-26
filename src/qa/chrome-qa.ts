import type { ChromeSpec, QAResult } from "../types.js";

export function runChromeQA(spec: ChromeSpec): QAResult {
  const issues: QAResult["issues"] = [];

  if (!spec.footer.ctaLabel?.trim()) {
    issues.push({
      severity: "hard",
      code: "MISSING_FOOTER_CTA",
      message: "Footer CTA label is required",
    });
  }

  if (!spec.footer.ctaHref?.trim()) {
    issues.push({
      severity: "hard",
      code: "MISSING_FOOTER_CTA_HREF",
      message: "Footer CTA href is required",
    });
  }

  const hasLinks =
    (spec.footer.linkGroups?.length ?? 0) > 0 ||
    spec.footer.layout === "centered";
  if (!hasLinks && spec.footer.layout === "two-column") {
    issues.push({
      severity: "soft",
      code: "EMPTY_LINK_GROUPS",
      message: "Two-column footer has no link groups",
    });
  }

  if (spec.footer.layout === "cta-heavy" && !spec.footer.tagline?.trim()) {
    issues.push({
      severity: "soft",
      code: "CTA_HEAVY_NO_TAGLINE",
      message: "CTA-heavy footer should have a tagline",
    });
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return { passed: hard.length === 0, issues };
}
