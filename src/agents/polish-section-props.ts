import type { ExpandedBrief } from "../types.js";

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? text).trim();
}

function headlineFallback(templateId: string, brief: ExpandedBrief, intent: string): string {
  const shortIntent = intent.length <= 48 ? intent : firstSentence(brief.elevatorPitch);
  switch (templateId) {
    case "hero_editorial":
    case "hero_split_cinematic":
      return brief.businessName;
    case "intro_statement":
      return brief.tagline || firstSentence(brief.elevatorPitch);
    case "services_showcase":
      return (shortIntent.replace(/^preview the /i, "").replace(/^showcase /i, "") || brief.services[0]) ?? "Our craft";
    case "cta_band":
      return brief.primaryCta;
    default:
      return shortIntent.length <= 56 ? shortIntent : firstSentence(brief.elevatorPitch);
  }
}

function cleanParagraph(text: string): string {
  let p = text.trim();
  // LLM sometimes dumps differentiators as "A. B. C." one-liners
  if (/\.\s+[A-Z][a-z]+ [A-Z]/.test(p) && p.split(". ").length > 4) {
    p = firstSentence(p);
  }
  if (p.length > 420) {
    p = p.slice(0, 400).trim().replace(/\s+\S*$/, "") + "…";
  }
  return p;
}

export function polishSectionProps(
  templateId: string,
  props: Record<string, unknown>,
  intent: string,
  brief: ExpandedBrief
): Record<string, unknown> {
  const out = { ...props };
  const intentNorm = intent.trim().toLowerCase();

  if (typeof out.label === "string") {
    const label = out.label.trim();
    if (
      label.length > 40 ||
      label.toLowerCase() === intentNorm ||
      label === out.headline
    ) {
      delete out.label;
    }
  }

  if (typeof out.headline === "string") {
    const headline = out.headline.trim();
    if (
      headline.toLowerCase() === intentNorm ||
      headline.length > 72 ||
      /^(highlight|preview|showcase|introduce|present)\s/i.test(headline)
    ) {
      out.headline = headlineFallback(templateId, brief, intent);
    }
  }

  if (typeof out.body === "string") {
    out.body = cleanParagraph(out.body);
  }

  if (Array.isArray(out.paragraphs)) {
    const paragraphs = out.paragraphs
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map(cleanParagraph)
      .filter((p, i, arr) => arr.indexOf(p) === i)
      .slice(0, 3);
    out.paragraphs = paragraphs.length ? paragraphs : [firstSentence(brief.elevatorPitch)];
  }

  if (typeof out.subcopy === "string" && out.subcopy.length > 120) {
    out.subcopy = out.subcopy.slice(0, 110).trim() + "…";
  }

  return out;
}
