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

const LANDMARK_RULES: Array<{ landmark: Landmark; re: RegExp }> = [
  { landmark: "hero", re: /\b(hero|welcome|masthead|headline|start bootstrap)\b/i },
  { landmark: "features", re: /\b(feature|service|offer|what we|capabilities|solution)\b/i },
  { landmark: "story", re: /\b(about|story|showcase|how it works|process)\b/i },
  { landmark: "gallery", re: /\b(gallery|portfolio|work|lookbook|project)\b/i },
  { landmark: "testimonials", re: /\b(testimonial|review|quote|customer|client say)\b/i },
  { landmark: "pricing", re: /\b(pricing|plan|package|membership)\b/i },
  { landmark: "faq", re: /\b(faq|question|answer)\b/i },
  { landmark: "contact", re: /\b(contact|enquiry|get in touch)\b/i },
  { landmark: "cta", re: /\b(get started|sign up|book|call to action|ready to|try it)\b/i },
  { landmark: "team", re: /\b(team|people|founders|staff)\b/i },
  { landmark: "stats", re: /\b(stat|number|metric|proof)\b/i },
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
