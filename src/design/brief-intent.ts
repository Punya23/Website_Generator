import type { SiteContext } from "../types.js";
import { isTemplateRelevant } from "./template-relevance.js";

export interface BriefIntent {
  pricing: boolean;
  team: boolean;
  gallery: boolean;
  booking: boolean;
  menu: boolean;
  transformation: boolean;
}

const PRICING_RE =
  /\b(pricing|price|plan|membership|subscription|tier|package|monthly|yearly|fee|rate)\b/i;
const TEAM_RE = /\b(team|staff|doctor|dentist|practitioner|chef|stylist|founder|leadership)\b/i;
const GALLERY_RE = /\b(gallery|portfolio|showcase|work|projects|lookbook|photos)\b/i;
const BOOKING_RE = /\b(book|appointment|schedule|reserve|consultation|visit)\b/i;
const MENU_RE = /\b(menu|bakery|restaurant|cafe|food|pastry|bread|sourdough|catering)\b/i;
const TRANSFORM_RE = /\b(before.?after|transformation|results|outcome|improvement)\b/i;

function textFromContext(ctx: SiteContext): string {
  const parts = [
    ctx.businessBrief ?? "",
    ctx.expandedBrief?.expandedBrief ?? "",
    ctx.expandedBrief?.tagline ?? "",
    ...(ctx.expandedBrief?.services ?? []),
    ...(ctx.sitePlan?.pages.find((p) => p.slug === "home")?.contentFocus ?? []),
  ];
  return parts.join(" ").toLowerCase();
}

export function extractBriefIntent(ctx: SiteContext): BriefIntent {
  return extractBriefIntentFromText(textFromContext(ctx));
}

export function extractBriefIntentFromText(text: string): BriefIntent {
  const lower = text.toLowerCase();
  return {
    pricing: PRICING_RE.test(lower),
    team: TEAM_RE.test(lower),
    gallery: GALLERY_RE.test(lower),
    booking: BOOKING_RE.test(lower),
    menu: MENU_RE.test(lower),
    transformation: TRANSFORM_RE.test(lower),
  };
}

export function filterPoolSequence(
  sequence: Array<{ templateId: string; intent: string }>,
  ctx: { businessBrief: string; expandedBrief: import("../types.js").ExpandedBrief; sitePlan: import("../types.js").SitePlan }
): Array<{ templateId: string; intent: string }> {
  const intent = extractBriefIntent(ctx as SiteContext);
  return sequence.filter((s) => isTemplateRelevant(s.templateId, intent));
}

export function contentFocusBoost(templateId: string, contentFocus: string[]): number {
  const focus = contentFocus.join(" ").toLowerCase();
  let score = 0;
  if (/service|offer|menu/.test(focus) && /services|feature|bento|showcase/.test(templateId)) {
    score += 2;
  }
  if (/team|staff|people/.test(focus) && templateId.includes("team")) score += 3;
  if (/testimonial|review|proof/.test(focus) && templateId.includes("testimonial")) score += 3;
  if (/gallery|portfolio|work/.test(focus) && /gallery|portfolio|carousel/.test(templateId)) {
    score += 2;
  }
  if (/pricing|plan/.test(focus) && templateId.includes("pricing")) score += 3;
  return score;
}
