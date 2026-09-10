/**
 * Scope one template's stylesheets so several templates' verbatim sections can share a page.
 *
 * Every selector is nested under `[data-tpl="<templateId>"]`, which is what makes mixing
 * Bootstrap-based templates safe: two copies of `.container`, `.btn` or a global reset can no
 * longer reach each other's markup. Selector rewriting goes through an AST rather than string
 * prefixing, which breaks on comma lists, pseudo-elements and `:is()/:where()` arguments.
 */
import postcss, { type Root, type Rule, type AtRule } from "postcss";
import safeParser from "postcss-safe-parser";
import selectorParser from "postcss-selector-parser";

/** Selectors that address the document itself. Rewritten to the scope root rather than dropped,
 *  so the template's base typography/background still applies to its own sections — it just can
 *  no longer style the real page `<body>` out from under another template's sections. */
const ROOT_SELECTORS = new Set([":root", "html", "body", "html body"]);

/**
 * Real template packages ship CSS that no parser accepts as written — the confirmed case in this
 * repo's own bundle is a vendor file with SCSS-style `//` line comments left in a `.css` file.
 * Only line-leading `//` is stripped, so `url(https://…)` inside a value is untouched.
 */
export function sanitizeCss(css: string): string {
  return css.replace(/^[ \t]*\/\/[^\n]*$/gm, "");
}

/**
 * Templates in an unaudited corpus ship CSS with real syntax errors (a missing semicolon after
 * `font-family:"Roboto Slab"` in this repo's Kelsey sample). Browsers recover; postcss's strict
 * parser does not. Strict is tried first for fidelity, then the safe parser, so a single typo
 * costs a declaration rather than the whole stylesheet.
 */
export function parseCssTolerantly(css: string): Root {
  try {
    return postcss.parse(css);
  } catch {
    return safeParser(css);
  }
}

export interface ScopeCssOptions {
  templateId: string;
  /** Element-id renames from `id-rewrite.ts`, so `#hero {}` keeps matching its markup. */
  idRenames?: Map<string, string>;
}

/**
 * @param scope  the scope selector itself, e.g. `[data-tpl="tpl_ab12"]`
 *
 * The comma list is split through the selector AST (so commas inside `:is()`/`:not()` are not
 * mistaken for separators) and each resulting selector is prefixed individually.
 */
export function scopeSelector(selector: string, scope: string, idRenames?: Map<string, string>): string {
  const parts: string[] = [];
  selectorParser((root) => {
    root.each((sel) => {
      if (idRenames?.size) {
        sel.walkIds((idNode) => {
          const next = idRenames.get(idNode.value);
          if (next) idNode.value = next;
        });
      }
      parts.push(sel.toString().trim());
    });
  }).processSync(selector);

  const scoped = parts
    .filter(Boolean)
    .map((part) => (ROOT_SELECTORS.has(part.toLowerCase()) ? scope : `${scope} ${part}`));
  return scoped.length > 0 ? scoped.join(", ") : selector;
}

function namespaceKeyframeName(name: string, templateId: string): string {
  return `${templateId}__${name}`;
}

const ANIMATION_PROPS = new Set(["animation", "animation-name", "-webkit-animation", "-webkit-animation-name"]);

export function scopeCss(css: string, options: ScopeCssOptions): string {
  const scopeAttr = `[data-tpl="${options.templateId}"]`;
  const root = parseCssTolerantly(css);
  const keyframeNames = new Set<string>();

  root.walkAtRules((atRule: AtRule) => {
    if (/^(-\w+-)?keyframes$/i.test(atRule.name)) {
      const name = atRule.params.trim();
      if (name) {
        keyframeNames.add(name);
        atRule.params = namespaceKeyframeName(name, options.templateId);
      }
    }
  });

  root.walkRules((rule: Rule) => {
    // Rules inside @keyframes are stops (`0%`, `from`), not selectors — never scope them.
    const parent = rule.parent as { type?: string; name?: string } | undefined;
    if (parent?.type === "atrule" && /^(-\w+-)?keyframes$/i.test(parent.name ?? "")) return;
    try {
      rule.selector = scopeSelector(rule.selector, scopeAttr, options.idRenames);
    } catch {
      // Real packages contain selectors no parser accepts — an unbalanced comment in this repo's
      // own Arup sample leaves `***/ .animation1` behind. Prefixing the raw text still scopes the
      // rule (and such a selector matches nothing anyway); losing the whole stylesheet over one
      // line does not.
      rule.selector = `${scopeAttr} ${rule.selector}`;
    }
  });

  if (keyframeNames.size > 0) {
    root.walkDecls((decl) => {
      if (!ANIMATION_PROPS.has(decl.prop.toLowerCase())) return;
      for (const name of keyframeNames) {
        const re = new RegExp(`(^|[\\s,])${escapeRegExp(name)}($|[\\s,])`, "g");
        decl.value = decl.value.replace(re, (_m, a: string, b: string) =>
          `${a}${namespaceKeyframeName(name, options.templateId)}${b}`
        );
      }
    });
  }

  return root.toString();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
