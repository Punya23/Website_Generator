/**
 * Turns a text box's typography (font-size, line-height) and width into a character/word budget.
 *
 * No headless render, same trade-off `ingest/design-fingerprint.ts` makes for the scraped corpus:
 * a real layout pass per placement would be the accurate way to do this, but for a small, known set
 * of hand-authored templates a closed-form estimate from the stylesheet's own numbers is enough to
 * catch the failure this whole module exists to prevent (a headline several lines too long for its
 * box), and it never needs a browser.
 */
import type { TextConstraints } from "./schema.js";

export interface TypoSpec {
  fontSizePx: number;
  lineHeight: number;
}

/** `rem` -> `px` at this stylesheet's base (`html`/`body` never override the browser default). */
export function rem(value: number): number {
  return value * 16;
}

/**
 * The type scale actually used by `real-estate/*\/assets/css/style.css` — verified byte-identical
 * (structural rules) across all four templates; only color tokens differ. Keyed by role, read
 * straight off the stylesheet rather than parsed at runtime: there are a few dozen selectors, they
 * are already known, and hand-transcribing them is more reliable than a general CSS-to-typography
 * parser would be for a set this small (see `real-estate-map.ts`'s header comment for why this
 * template set is treated as hand-mapped rather than heuristically crawled).
 */
export const TYPE_SCALE: Record<string, TypoSpec> = {
  heroEyebrow: { fontSizePx: rem(0.82), lineHeight: 1.3 },
  heroTitle: { fontSizePx: rem(3.2), lineHeight: 1.25 },
  heroSubtitle: { fontSizePx: rem(1.1), lineHeight: 1.6 },
  pageBannerTitle: { fontSizePx: rem(2.4), lineHeight: 1.25 },
  sectionEyebrow: { fontSizePx: rem(0.85), lineHeight: 1.3 },
  sectionTitle: { fontSizePx: rem(2.2), lineHeight: 1.25 },
  sectionSubtitle: { fontSizePx: rem(1.02), lineHeight: 1.6 },
  cardPrice: { fontSizePx: rem(1), lineHeight: 1.2 },
  cardLocation: { fontSizePx: rem(0.82), lineHeight: 1.4 },
  cardTitle: { fontSizePx: rem(1.15), lineHeight: 1.25 },
  statNumber: { fontSizePx: rem(2.6), lineHeight: 1.2 },
  statLabelText: { fontSizePx: 16, lineHeight: 1.6 },
  agentName: { fontSizePx: rem(1.15), lineHeight: 1.25 },
  agentRole: { fontSizePx: rem(0.88), lineHeight: 1.3 },
  agentContact: { fontSizePx: rem(0.85), lineHeight: 1.4 },
  testimonialQuote: { fontSizePx: 16, lineHeight: 1.6 },
  testimonialAuthorName: { fontSizePx: rem(0.95), lineHeight: 1.3 },
  testimonialAuthorRole: { fontSizePx: rem(0.82), lineHeight: 1.3 },
  processTitle: { fontSizePx: rem(1.05), lineHeight: 1.25 },
  processText: { fontSizePx: rem(0.88), lineHeight: 1.6 },
  ctaHeading: { fontSizePx: rem(2), lineHeight: 1.25 },
  ctaBody: { fontSizePx: 16, lineHeight: 1.6 },
  footerAbout: { fontSizePx: rem(0.9), lineHeight: 1.5 },
  // Unstyled <h1> on property-detail.html / agent-detail.html — the reset only sets
  // line-height/weight for h1-h4, never font-size, so this is the browser default (2em of the
  // inherited 16px body size), not a value read from the stylesheet.
  unstyledH1: { fontSizePx: 32, lineHeight: 1.25 },
  detailPrice: { fontSizePx: rem(1.8), lineHeight: 1.2 },
  detailSectionHeading: { fontSizePx: rem(1.3), lineHeight: 1.25 },
  detailBody: { fontSizePx: 16, lineHeight: 1.6 },
  amenityItem: { fontSizePx: rem(0.92), lineHeight: 1.5 },
  sidebarBlurb: { fontSizePx: rem(0.85), lineHeight: 1.5 },
  infoCardText: { fontSizePx: rem(0.92), lineHeight: 1.5 },
};

/** `.container{max-width:1200px;padding:0 24px}` -> the actual content width inside it. */
export const CONTAINER_WIDTH_PX = 1200 - 2 * 24;
const GRID_GAP_PX = 30;

/** Width of one card in an N-column `.grid--N` laid out inside `.container` — `.property-card`,
 *  `.agent-card`, `.service-card` (grid--4 variant), `.stat-item`, `.testimonial-card` all share
 *  this same grid, just with different column counts per section. */
export function gridColumnWidthPx(columns: number): number {
  return Math.round((CONTAINER_WIDTH_PX - (columns - 1) * GRID_GAP_PX) / columns);
}

/** Average glyph width as a fraction of font-size for this stylesheet's proportional sans-serif
 *  stack (Inter/Poppins body text) — a standard typographic rule of thumb, not measured per font;
 *  good enough for a budget that's already anchored to the box's own real, shipped copy below. */
const AVG_CHAR_WIDTH_RATIO = 0.52;

/**
 * Character/word budget for a prose-shaped placement (a heading, a paragraph, a quote) — anything
 * where the text visibly wraps inside a box of known width.
 *
 * The geometric estimate from `widthPx`/`typo` sets the ceiling, but never BELOW the length of the
 * copy already shipping there: that copy renders correctly today at this exact font-size in this
 * exact box, so it is proof the estimate should not undercut, only ever raise, what the box can
 * hold. This also means a placements file regenerated after a slightly-off char-width constant
 * changes never invalidates the template's own existing copy.
 */
export function proseConstraints(
  typo: TypoSpec,
  widthPx: number,
  allowedLines: number,
  original: string
): TextConstraints {
  const originalLen = original.trim().length;
  const charsPerLine = Math.max(8, Math.floor(widthPx / (typo.fontSizePx * AVG_CHAR_WIDTH_RATIO)));
  const geometricCeiling = charsPerLine * allowedLines;
  const maxChars = Math.max(geometricCeiling, originalLen);
  // A rewrite half the length of a heading is still a heading; one under ~40% starts reading as a
  // different (and possibly broken/truncated-looking) placement, so that is the floor rather than
  // a hard word-count minimum.
  const minChars = Math.max(4, Math.round(originalLen * 0.4));
  const wordCount = Math.max(1, original.trim().split(/\s+/).filter(Boolean).length);
  return {
    minChars,
    maxChars,
    minWords: Math.max(1, Math.round(wordCount * 0.5)),
    maxWords: Math.max(wordCount, Math.round(maxChars / 6)),
    maxLines: allowedLines,
  };
}

/**
 * Character/word budget for a label-shaped placement (a nav link, a button, a badge) — text short
 * enough that "does it read as a label" matters more than literal pixel width, so this bounds word
 * count directly instead of deriving it from a box that is usually sized to fit its content anyway
 * (an inline-flex button, a badge with no fixed width).
 */
export function labelConstraints(maxWords: number, original: string): TextConstraints {
  const originalLen = original.trim().length;
  const wordCount = Math.max(1, original.trim().split(/\s+/).filter(Boolean).length);
  const AVG_WORD_LEN_WITH_SPACE = 8;
  const maxChars = Math.max(originalLen, maxWords * AVG_WORD_LEN_WITH_SPACE);
  return {
    minChars: Math.max(1, Math.round(originalLen * 0.5)),
    maxChars,
    minWords: 1,
    maxWords: Math.max(wordCount, maxWords),
    maxLines: 1,
  };
}
