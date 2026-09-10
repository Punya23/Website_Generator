/**
 * Reduce a template's stylesheet to the rules the placed markup can actually use.
 *
 * Ingest merges every stylesheet a template's pages referenced into one file, because a section is
 * only known to be selectable after classification and any of its pages' sheets might style it.
 * Composition then links that whole file — so borrowing one hero from an 18-page template shipped
 * all 18 pages' CSS (and, through it, all 18 pages' background images) onto a site that renders one
 * section of it. That is the "it takes the whole template, not the page" problem: the fix is not to
 * guess which source page a section came from, it is to keep only what the composed markup can
 * match, which is strictly narrower than any per-page split would be.
 *
 * Deliberately conservative — a dropped rule that should have applied is a visibly broken page,
 * while a kept rule that never matches costs bytes:
 * - a rule survives if ANY selector in its comma list could match, and the list is rewritten to
 *   just the surviving selectors;
 * - `:not()/:is()/:where()/:has()` arguments are never treated as requirements (a class inside
 *   `:not()` is a reason to keep, not to drop);
 * - attribute selectors only require the attribute NAME to exist, never a value match;
 * - anything whose selector cannot be parsed is kept.
 * Set TEMPLATE_CSS_SHAKE=0 to turn the whole pass off and ship the merged sheet as before.
 */
import * as cheerio from "cheerio";
import selectorParser from "postcss-selector-parser";
import type { AtRule, ChildNode, Container, Declaration, Root, Rule } from "postcss";
import { parseCssTolerantly } from "./scope-css.js";

export interface MarkupTokens {
  classes: Set<string>;
  ids: Set<string>;
  tags: Set<string>;
  attrs: Set<string>;
}

/**
 * Pre-seeded with the wrapper composition puts around every section
 * (`<div data-tpl data-role data-section>`): scoping rewrote EVERY selector to sit under
 * `[data-tpl="…"]`, and that attribute is never in the section's own markup — without seeding it
 * the attribute test below rejects every rule in the stylesheet.
 */
export function emptyTokens(): MarkupTokens {
  return {
    classes: new Set(),
    ids: new Set(),
    tags: new Set(["div"]),
    attrs: new Set(["data-tpl", "data-role", "data-section", "class", "id", "style"]),
  };
}

/** Collect every class/id/tag/attribute name the markup contains, merging into `into` when given
 *  (several sections from one template share a page, and share its shaken stylesheet). */
export function collectMarkupTokens(html: string, into: MarkupTokens = emptyTokens()): MarkupTokens {
  const $ = cheerio.load(html, null, false);
  $("*").each((_, node) => {
    const el = node as { tagName?: string; attribs?: Record<string, string> };
    const tag = el.tagName?.toLowerCase();
    if (tag) into.tags.add(tag);
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      into.attrs.add(name.toLowerCase());
      if (name === "class") {
        for (const cls of value.split(/\s+/)) if (cls) into.classes.add(cls);
      } else if (name === "id" && value) {
        into.ids.add(value);
      }
    }
  });
  return into;
}

const ANIMATION_PROPS = new Set(["animation", "animation-name", "-webkit-animation", "-webkit-animation-name"]);
const FONT_PROPS = new Set(["font", "font-family"]);
/** At-rules whose children are ordinary rules and so can be shaken in place. */
const NESTED_AT_RULES = /^(-\w+-)?(media|supports|container|layer|scope|document)$/i;
const KEYFRAMES_AT_RULE = /^(-\w+-)?keyframes$/i;

function selectorCanMatch(selector: string, tokens: MarkupTokens): boolean {
  let possible = true;
  const check = (container: { nodes?: unknown[] }): void => {
    for (const raw of (container.nodes ?? []) as Array<{ type: string; value?: string; attribute?: string; nodes?: unknown[] }>) {
      if (!possible) return;
      switch (raw.type) {
        case "class":
          if (raw.value && !tokens.classes.has(raw.value)) possible = false;
          break;
        case "id":
          if (raw.value && !tokens.ids.has(raw.value)) possible = false;
          break;
        case "tag":
          if (raw.value && !tokens.tags.has(raw.value.toLowerCase())) possible = false;
          break;
        case "attribute":
          // Name only: `[class*='logo']` needs a `class` attribute somewhere, not that exact value.
          if (raw.attribute && !tokens.attrs.has(raw.attribute.toLowerCase())) possible = false;
          break;
        case "pseudo":
          // Never descend: `:not(.gone)` is satisfied by markup that lacks `.gone`, and
          // `:is(.a, .b)` needs only one branch. Treating either as a requirement drops live rules.
          break;
        default:
          break; // combinator, universal, string, nesting, comment — no requirement
      }
    }
  };

  try {
    selectorParser((root) => {
      root.each((sel) => check(sel as unknown as { nodes?: unknown[] }));
    }).processSync(selector);
  } catch {
    return true; // unparseable selector (real packages ship them) — keep the rule
  }
  return possible;
}

/** Split a comma list through the AST (commas inside `:is()` are not separators) and keep only the
 *  selectors that can match. Returns null when none survive. */
function surviveSelectors(selector: string, tokens: MarkupTokens): string | null {
  let parts: string[];
  try {
    parts = [];
    selectorParser((root) => {
      root.each((sel) => {
        parts.push(sel.toString().trim());
      });
    }).processSync(selector);
  } catch {
    return selector; // keep as-is rather than lose a rule to a parse failure
  }
  if (parts.length === 0) return selector;
  const kept = parts.filter((part) => part && selectorCanMatch(part, tokens));
  if (kept.length === 0) return null;
  return kept.length === parts.length ? selector : kept.join(", ");
}

function shakeContainer(container: Container, tokens: MarkupTokens, stats: { kept: number; dropped: number }): void {
  const children = [...(container.nodes ?? [])] as ChildNode[];
  for (const node of children) {
    if (node.type === "rule") {
      const rule = node as Rule;
      const parent = rule.parent as { type?: string; name?: string } | undefined;
      // Keyframe stops (`0%`, `from`) are not selectors — their at-rule is handled as a unit.
      if (parent?.type === "atrule" && KEYFRAMES_AT_RULE.test(parent.name ?? "")) continue;
      const survived = surviveSelectors(rule.selector, tokens);
      if (survived === null) {
        stats.dropped += 1;
        rule.remove();
      } else {
        stats.kept += 1;
        rule.selector = survived;
      }
    } else if (node.type === "atrule") {
      const atRule = node as AtRule;
      if (KEYFRAMES_AT_RULE.test(atRule.name)) continue; // resolved in the second pass below
      if (NESTED_AT_RULES.test(atRule.name)) {
        shakeContainer(atRule, tokens, stats);
        if ((atRule.nodes ?? []).length === 0) atRule.remove();
      }
    }
  }
}

/** Font-family value as written in an `@font-face`, normalized for a substring test. */
function fontFamilyOf(atRule: AtRule): string | null {
  let family: string | null = null;
  atRule.walkDecls((decl: Declaration) => {
    if (decl.prop.toLowerCase() === "font-family") {
      family = decl.value.replace(/['"]/g, "").trim().toLowerCase();
    }
  });
  return family;
}

export interface ShakeResult {
  css: string;
  rulesKept: number;
  rulesDropped: number;
}

export function shakeCss(css: string, tokens: MarkupTokens): ShakeResult {
  const root: Root = parseCssTolerantly(css);
  const stats = { kept: 0, dropped: 0 };
  shakeContainer(root, tokens, stats);

  // Second pass: an @keyframes or @font-face is only reachable through a declaration that survived.
  const animationNames = new Set<string>();
  const fontUsage: string[] = [];
  root.walkDecls((decl: Declaration) => {
    const parent = decl.parent as { type?: string; name?: string } | undefined;
    // An @font-face's own `font-family` is its declaration, not a usage of it — counting it would
    // make every face look referenced and the whole pass a no-op for fonts.
    if (parent?.type === "atrule" && parent.name?.toLowerCase() === "font-face") return;
    const prop = decl.prop.toLowerCase();
    if (ANIMATION_PROPS.has(prop)) {
      for (const token of decl.value.split(/[\s,]+/)) if (token) animationNames.add(token);
    } else if (FONT_PROPS.has(prop)) {
      fontUsage.push(decl.value.replace(/['"]/g, "").toLowerCase());
    }
  });
  const fontHaystack = fontUsage.join(" | ");

  root.walkAtRules((atRule: AtRule) => {
    if (KEYFRAMES_AT_RULE.test(atRule.name)) {
      if (!animationNames.has(atRule.params.trim())) {
        stats.dropped += 1;
        atRule.remove();
      }
      return;
    }
    if (atRule.name.toLowerCase() === "font-face") {
      const family = fontFamilyOf(atRule);
      // An unreadable @font-face is kept: a missing icon font is a visibly broken page.
      if (family && !fontHaystack.includes(family)) {
        stats.dropped += 1;
        atRule.remove();
      }
    }
  });

  return { css: root.toString(), rulesKept: stats.kept, rulesDropped: stats.dropped };
}
