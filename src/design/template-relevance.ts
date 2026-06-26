import type { BriefIntent } from "./brief-intent.js";

const PRICING_TEMPLATES = new Set(["pricing_toggle", "pricing_tiers"]);
const GALLERY_TEMPLATES = new Set([
  "gallery_masonry",
  "horizontal_gallery",
  "portfolio_carousel",
]);

/** Shared relevance rules for pool filtering and blueprint trim. */
export function isTemplateRelevant(templateId: string, intent: BriefIntent): boolean {
  if (PRICING_TEMPLATES.has(templateId) && !intent.pricing) return false;
  if (templateId === "team_grid" && !intent.team) return false;
  if (GALLERY_TEMPLATES.has(templateId) && !intent.gallery && !intent.menu) return false;
  if (templateId === "before_after" && !intent.transformation) return false;
  return true;
}

const FAQ_RE = /\b(faq|frequently asked|questions|help center)\b/i;

export function isOptionalPageRelevant(
  slug: string,
  intent: BriefIntent,
  briefText: string
): boolean {
  if (slug === "team") return intent.team;
  if (slug === "pricing") return intent.pricing;
  if (slug === "gallery") return intent.gallery || intent.menu;
  if (slug === "faq") return FAQ_RE.test(briefText) || intent.booking;
  return true;
}
