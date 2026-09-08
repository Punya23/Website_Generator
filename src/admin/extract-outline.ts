import type { Landmark, PageOutline } from "./types.js";

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "));
}

// Bare-singular keywords miss their own plural in real headings: "s"/"_" are both `\w` chars, so
// `\bfaq\b` finds no word boundary immediately before the "s" in "FAQs" and never matches it.
// Confirmed live against the real corpus: a template's own "<h1>FAQs</h1>" inner-page header
// landed in role "other" — an entire real page's content invisible to selection — purely because
// of this. `s?` on each regular noun below fixes that class of miss; irregular plurals (gallery)
// get an explicit alternative instead of a wrong `s` suffix. Also added a few common
// vertical-specific synonyms found the same way (a fitness template's own "Classes"/"Instructors"
// inner pages, which the previous generic-only vocabulary had no entry for at all) — full
// per-vertical vocabulary is a bigger, separate piece of work (see the "dynamic page curation"
// discussion this was found alongside), but these cost nothing to add now.
const LANDMARK_RULES: Array<{ landmark: Landmark; re: RegExp }> = [
  { landmark: "hero", re: /\b(hero|welcome|masthead|headlines?|start bootstrap)\b/i },
  {
    landmark: "features",
    re: /\b(features?|services?|offers?|what we|capabilit(?:y|ies)|solutions?|classes)\b/i,
  },
  { landmark: "story", re: /\b(about|story|showcase|how it works|process)\b/i },
  { landmark: "gallery", re: /\b(gallery|galleries|portfolios?|work|lookbook|projects?)\b/i },
  { landmark: "testimonials", re: /\b(testimonials?|reviews?|quotes?|customers?|client say)\b/i },
  { landmark: "pricing", re: /\b(pricing|plans?|packages?|membership)\b/i },
  { landmark: "faq", re: /\b(faqs?|questions?|answers?)\b/i },
  // "office hours" added after tracing a real miss: a template's contact-page form section led
  // with three info-cards (Office Address / Phone & Email / Office Hours) before its own "Send Us
  // a Message" heading — `headingText` (extract-sections.ts) is only ever the FIRST h1/h2/h3 in the
  // section, so the real identifying heading was invisible to that check; "office hours" survives
  // because the 200-char text fallback below reaches it (confirmed: it sits at ~140 chars in, well
  // inside the window) even when the heading check can't.
  { landmark: "contact", re: /\b(contact|enquir(?:y|ies)|get in touch|office hours)\b/i },
  { landmark: "cta", re: /\b(get started|sign up|book|call to action|ready to|try it)\b/i },
  { landmark: "team", re: /\b(teams?|people|founders?|staff|instructors?|trainers?)\b/i },
  { landmark: "stats", re: /\b(stats?|numbers?|metrics?|proof)\b/i },
];

export function inferLandmark(text: string): Landmark {
  for (const rule of LANDMARK_RULES) {
    if (rule.re.test(text)) return rule.landmark;
  }
  return "other";
}

export function extractOutline(html: string, fallbackTitle = "Untitled"): PageOutline {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1] ?? "") : fallbackTitle;

  const headings: PageOutline["headings"] = [];
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html))) {
    const text = stripTags(match[2] ?? "");
    if (text.length < 2 || text.length > 120) continue;
    headings.push({ level: Number(match[1]), text });
  }

  const landmarks = [...new Set(headings.map((h) => inferLandmark(h.text)))].filter(
    (item) => item !== "other"
  );
  if (!landmarks.includes("hero") && headings.length > 0) landmarks.unshift("hero");

  return {
    title: title || fallbackTitle,
    headings: headings.slice(0, 24),
    landmarks,
  };
}

export function parseGithubRepo(url: string): { owner: string; repo: string } | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("github.com")) return undefined;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return undefined;
    return { owner: parts[0]!, repo: parts[1]!.replace(/\.git$/, "") };
  } catch {
    return undefined;
  }
}

const PAGE_SLUG_RE = /\b(about|story|services|service|work|pricing|contact|team|pricing)\b/i;

export function inferPageSlug(url: string, linkText: string): "about" | "services" | "contact" | undefined {
  const hay = `${url} ${linkText}`.toLowerCase();
  if (/\b(contact|enquiry|get-in-touch)\b/.test(hay)) return "contact";
  if (/\b(service|offer|pricing|work)\b/.test(hay)) return "services";
  if (/\b(about|story|team)\b/.test(hay)) return "about";
  return undefined;
}

export function extractSameOriginLinks(html: string, baseUrl: string): Array<{ url: string; text: string }> {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const links: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = match[1] ?? "";
    if (!href || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin) continue;
    const normalized = `${resolved.origin}${resolved.pathname.replace(/\/$/, "") || "/"}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const text = stripTags(match[2] ?? "").slice(0, 80);
    if (!PAGE_SLUG_RE.test(`${resolved.pathname} ${text}`)) continue;
    links.push({ url: resolved.href, text });
  }
  return links.slice(0, 12);
}

export function pathAllowedByRobots(robotsText: string, path: string): boolean {
  const lines = robotsText.split(/\r?\n/);
  let applies = false;
  const disallows: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      const value = ua[1]!.trim();
      applies = value === "*" || /website-generator-ingest/i.test(value);
      continue;
    }
    if (!applies) continue;
    const dis = line.match(/^disallow:\s*(.*)$/i);
    if (dis) disallows.push((dis[1] ?? "").trim());
  }
  if (disallows.includes("/")) return false;
  return !disallows.some((rule) => rule && path.startsWith(rule));
}
