import type { CustomSectionCodegen, SectionInstance, SiteContext } from "../types.js";
import { transformSync } from "esbuild";
import { llm } from "../llm/client.js";
import { useBespokeSectionCodegen } from "../llm/pipeline-speed.js";
import { strictLlmRequired, handleLlmFailure, requireLlm } from "../util/llm-required.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";

/**
 * Section kinds with nontrivial embedded interactivity (slider state, drag comparison,
 * toggle/accordion state) are excluded from bespoke codegen — reauthoring their JS behavior
 * from scratch each generation is high risk for low visual payoff versus the well-tested
 * fixed components. Everything else is eligible.
 */
const BESPOKE_CODEGEN_EXCLUDED = new Set([
  "testimonial_carousel",
  "portfolio_carousel",
  "before_after",
  "pricing_toggle",
  "faq_accordion",
  "horizontal_gallery",
]);

const FORBIDDEN_PATTERNS = [
  /\beval\s*\(/,
  /dangerouslySetInnerHTML/,
  /\bfetch\s*\(/,
  /require\s*\(/,
  /import\s*\(/,
  /process\.env/,
  /child_process/,
  /fs\./,
];

const BESPOKE_SECTION_PROMPT = `You generate ONE bespoke React section component for a premium marketing site (Framer quality). You are given the section's creative intent and the exact props it will receive — write a visually distinctive implementation, not a generic card/grid.

Output ONLY valid TSX source — no markdown fences, no explanation.

Rules:
- First line MUST be exactly: "use client";
- Do NOT repeat use client anywhere else (no bare use client; without quotes).
- Import ONLY from "react", "framer-motion", and "@/components/primitives" — using EXACTLY these prop names (anything not listed here does not exist, do not invent props):
  Container({ children, className?, narrow?: false|"sm"|"md"|"lg" })
  SectionBody({ children, className? })
  ContentMeasure({ children, size?: "sm"|"md"|"lg"|"full", className? })
  DisplayHeading({ children, as?: "h1"|"h2"|"h3", className? })
  SplitRevealHeading({ text: string, as?: "h1"|"h2"|"h3", className? })  — takes a text STRING prop, not children
  SectionLabel({ children })  — children only, no className or id
  MonoTag({ children })  — children only, no className or id
  PrimaryButton({ href?, children })  — no className
  MagneticButton({ href?, children, className? })
  SectionDivider({ variant?: "angle"|"fade" })  — no children
  Reveal({ children, className?, delay?: number })
  Stagger({ children, className? })
  StaggerItem({ children, className? })  — no delay prop
  SplitHeroLayout({ copy: ReactNode, media: ReactNode, mediaRight?: boolean, className? })  — prop names are exactly "copy" and "media", nothing else
  CardGrid({ children, columns?: 2|3|4, className? })
  BentoGrid({ children, className? })
  CursorSpotlight({ children, className?, intensity?: number })
  GlassPanel({ children, className? })
  NoiseGradientBg({ children?, className?, strong?: boolean })
  TextScrub({ text: string, className? })  — takes a text STRING prop, not children
  ScrollPinSection({ children, media?: ReactNode, className?, minHeight?: string })
  HorizontalScrollTrack({ children, className? })
- Do NOT import React (no default or named React import). Use named hooks from "react" only when needed (e.g. useRef).
- Export default function <ComponentName>(props: <TypeName>) using the exact names given below — include the type block before the component, matching the given props type exactly (do not add or remove fields).
- Every prop in the type is optional (marked with ?) — every nested field access must use optional chaining (props.cta?.label, props.image?.src) or a fallback (??). Never write props.cta.label or props.image.src directly.
- Use semantic Tailwind tokens: bg-bg, text-text, text-muted, bg-accent, text-white, border-border.
- Render EVERY item in every array prop you're given — the count is already correct, don't drop items or invent new ones.
- Use props exactly as given — do not invent fields not present in the props JSON.
- One primary CTA if a cta prop is present.
- No external URLs except *.src fields already present in props.
- Keep under 140 lines.`;

export function shouldAttemptBespokeSection(
  ctx: SiteContext,
  section: { templateId: string; id: string }
): boolean {
  if (BESPOKE_CODEGEN_EXCLUDED.has(section.templateId)) return false;
  return useBespokeSectionCodegen();
}

const USE_CLIENT_LINE = /^\s*("use client"|'use client'|use\s+client)\s*;?\s*$/i;

/** PascalCase components exported from @/components/primitives — bespoke codegen may only use these. */
const PRIMITIVE_COMPONENTS = new Set([
  "Container",
  "SectionBody",
  "ContentMeasure",
  "DisplayHeading",
  "SplitRevealHeading",
  "SectionLabel",
  "MonoTag",
  "PrimaryButton",
  "MagneticButton",
  "SectionDivider",
  "Reveal",
  "Stagger",
  "StaggerItem",
  "SplitHeroLayout",
  "CardGrid",
  "BentoGrid",
  "CursorSpotlight",
  "GlassPanel",
  "NoiseGradientBg",
  "TextScrub",
  "ScrollPinSection",
  "HorizontalScrollTrack",
]);

const PRIMITIVES_IMPORT_RE = /import\s+\{([^}]+)\}\s+from\s+["']@\/components\/primitives["'];?/;
const FRAMER_MOTION_IMPORT_RE = /import\s+\{([^}]+)\}\s+from\s+["']framer-motion["'];?/;

function findMatchingBraceClose(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function typeStartRegex(typeName: string): RegExp {
  return new RegExp(`type\\s+${typeName}\\s*=\\s*\\{`);
}

function replaceTypeBlock(body: string, typeName: string, typeBlock: string): string {
  const match = typeStartRegex(typeName).exec(body);
  if (!match) return body;

  const braceStart = body.indexOf("{", match.index);
  const braceEnd = findMatchingBraceClose(body, braceStart);
  if (braceEnd < 0) return body;

  let end = braceEnd + 1;
  while (end < body.length && /\s/.test(body[end]!)) end++;
  if (body[end] === ";") end++;

  return body.slice(0, match.index) + typeBlock + body.slice(end);
}

function stripOrphanTypeFields(body: string, typeName: string): string {
  const startRe = new RegExp(`^type\\s+${typeName}\\s*=`);
  const lines = body.split("\n");
  const out: string[] = [];
  let afterTypeClose = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (startRe.test(trimmed)) {
      afterTypeClose = false;
      out.push(line);
      continue;
    }
    if (afterTypeClose && /^\w+\??:/.test(trimmed)) {
      continue;
    }
    if (trimmed === "};" && out.some((l) => startRe.test(l.trim()))) {
      afterTypeClose = true;
    } else if (trimmed && !/^\w+\??:/.test(trimmed)) {
      afterTypeClose = false;
    }
    out.push(line);
  }

  return out.join("\n");
}

function cleanupTrailingTypeGarbage(body: string, typeBlock: string): string {
  const idx = body.indexOf(typeBlock);
  if (idx < 0) return body;

  const head = body.slice(0, idx + typeBlock.length);
  let tail = body.slice(idx + typeBlock.length);

  while (/^\s*\w+\??:[^\n]*\n/.test(tail) || /^\s*\};\s*\n/.test(tail)) {
    tail = tail
      .replace(/^\s*\w+\??:[^\n]*\n/, "")
      .replace(/^\s*\};\s*\n/, "");
  }

  return head + tail;
}

function normalizePropsType(body: string, typeName: string, typeBlock: string): string {
  let out = body;
  if (typeStartRegex(typeName).test(out)) {
    out = replaceTypeBlock(out, typeName, typeBlock);
  }
  return stripOrphanTypeFields(out, typeName);
}

function normalizeImports(body: string): string {
  let out = body.replace(
    /^\s*import\s+\{\s*React\s*\}\s+from\s+['"]react['"];\s*\n?/gm,
    ""
  );

  if (!/\bReact\./.test(out) && !/<React[\s>.]/.test(out)) {
    out = out.replace(/^\s*import\s+React\s+from\s+['"]react['"];\s*\n?/gm, "");
  }

  out = out.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]react['"];/g,
    (_match, specifiers: string) => {
      const names = specifiers
        .split(",")
        .map((s) => s.trim())
        .filter((name) => name && name !== "React" && !name.startsWith("React "));
      if (names.length === 0) return "";
      return `import { ${names.join(", ")} } from "react";`;
    }
  );

  return out.replace(/\n{3,}/g, "\n\n");
}

function ensureTypedProps(body: string, typeName: string, typeBlock: string): string {
  let out = normalizeImports(body);
  out = normalizePropsType(out, typeName, typeBlock);

  if (!new RegExp(`\\b${typeName}\\b`).test(out)) {
    const lines = out.split("\n");
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim().startsWith("import ")) insertAt = i + 1;
    }
    lines.splice(insertAt, 0, "", typeBlock);
    out = lines.join("\n");
  }

  out = out.replace(
    /export default function (\w+)\(\s*props\s*(?::\s*\w+)?\s*\)/,
    (_m, name: string) => `export default function ${name}(props: ${typeName})`
  );

  return cleanupTrailingTypeGarbage(out, typeBlock);
}

/** Mechanically repair the most common, deterministic mistakes the LLM makes before validation,
 *  instead of rejecting the whole section over them. Each is a safe, purely syntactic transform
 *  that produces exactly what the validator wants — recovering bespoke sections that would
 *  otherwise fall back to the fixed template. Anything not fixable here still hits validation and
 *  falls back safely. */
function stripBareUseClientLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (/^["']use client["']\s*;?\s*$/i.test(trimmed)) return false;
      return !/^use\s+client\s*;?\s*$/i.test(trimmed);
    })
    .join("\n");
}

function extractJsxPascalTags(source: string): string[] {
  const tags = new Set<string>();
  const re = /<([A-Z][A-Za-z0-9]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    tags.add(match[1]!);
  }
  return [...tags];
}

function parseNamedImportSpecifiers(source: string, importRe: RegExp): Set<string> {
  const names = new Set<string>();
  const match = importRe.exec(source);
  if (!match) return names;
  for (const part of match[1]!.split(",")) {
    const name = part.trim().split(/\s+as\s+/)[0]!.trim();
    if (name) names.add(name);
  }
  return names;
}

/** Auto-inject missing @/components/primitives and framer-motion imports the LLM used in JSX. */
export function ensureBespokeImports(source: string): string {
  let out = source;

  const usedPrimitives = extractJsxPascalTags(out).filter((tag) => PRIMITIVE_COMPONENTS.has(tag));
  if (usedPrimitives.length > 0) {
    const imported = parseNamedImportSpecifiers(out, PRIMITIVES_IMPORT_RE);
    const missing = usedPrimitives.filter((tag) => !imported.has(tag));
    if (missing.length > 0) {
      if (PRIMITIVES_IMPORT_RE.test(out)) {
        const merged = [...new Set([...imported, ...missing])].sort();
        out = out.replace(
          PRIMITIVES_IMPORT_RE,
          `import { ${merged.join(", ")} } from "@/components/primitives";`
        );
      } else {
        const lines = out.split("\n");
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i]!.trim();
          if (trimmed.startsWith("import ")) {
            insertAt = i;
            break;
          }
          if (trimmed && !trimmed.startsWith('"use client') && !trimmed.startsWith("'use client")) {
            insertAt = i;
            break;
          }
        }
        lines.splice(
          insertAt,
          0,
          `import { ${missing.join(", ")} } from "@/components/primitives";`
        );
        out = lines.join("\n");
      }
    }
  }

  if (/\bmotion\./.test(out)) {
    const imported = parseNamedImportSpecifiers(out, FRAMER_MOTION_IMPORT_RE);
    if (!imported.has("motion")) {
      if (FRAMER_MOTION_IMPORT_RE.test(out)) {
        const merged = [...new Set([...imported, "motion"])].sort();
        out = out.replace(
          FRAMER_MOTION_IMPORT_RE,
          `import { ${merged.join(", ")} } from "framer-motion";`
        );
      } else {
        const lines = out.split("\n");
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.trim().startsWith("import ")) {
            insertAt = i;
            break;
          }
        }
        lines.splice(insertAt, 0, `import { motion } from "framer-motion";`);
        out = lines.join("\n");
      }
    }
  }

  return out;
}

function validateBespokeImports(source: string): string | null {
  const importedPrimitives = parseNamedImportSpecifiers(source, PRIMITIVES_IMPORT_RE);
  for (const tag of extractJsxPascalTags(source)) {
    if (!PRIMITIVE_COMPONENTS.has(tag)) continue;
    if (!importedPrimitives.has(tag)) {
      return `Missing import for primitive ${tag}`;
    }
  }
  if (/\bmotion\./.test(source)) {
    const importedMotion = parseNamedImportSpecifiers(source, FRAMER_MOTION_IMPORT_RE);
    if (!importedMotion.has("motion")) {
      return "Missing framer-motion import for motion.*";
    }
  }
  return null;
}

export function autofixBespokeSource(source: string): string {
  let out = stripBareUseClientLines(source);

  // Unsafe optional member access on props.cta — the single most common failure. `props.cta.label`
  // crashes at runtime when cta is undefined (it's optional); convert to `props.cta?.label`. Only
  // matches `props.cta.` (cta immediately followed by a dot), so already-correct `props.cta?.` is
  // left untouched.
  out = out.replace(/\bprops\.cta\.(?=[A-Za-z_])/g, "props.cta?.");

  // PrimaryButton accepts only href + children — strip any className attribute the LLM added
  // (MagneticButton, which does accept className, is intentionally not touched).
  out = out.replace(/<PrimaryButton\b[^>]*>/g, (tag) =>
    tag.replace(/\s+className=(?:"[^"]*"|'[^']*'|\{[^{}]*\})/g, "")
  );

  return out;
}

export function sanitizeBespokeSource(source: string, typeName: string, typeBlock: string): string {
  const withoutFences = source
    .trim()
    .replace(/^```(?:tsx|typescript)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  const body = autofixBespokeSource(
    stripBareUseClientLines(
      withoutFences
        .split("\n")
        .filter((line) => !USE_CLIENT_LINE.test(line))
        .join("\n")
        .replace(/^\n+/, "")
    )
  );

  const typed = ensureTypedProps(body, typeName, typeBlock);
  const withImports = ensureBespokeImports(typed);
  return `"use client";\n\n${stripBareUseClientLines(withImports)}`;
}

function hasOrphanTypeFields(source: string, typeName: string): boolean {
  const match = typeStartRegex(typeName).exec(source);
  if (!match) return false;

  const braceStart = source.indexOf("{", match.index);
  const braceEnd = findMatchingBraceClose(source, braceStart);
  if (braceEnd < 0) return false;

  let scan = braceEnd + 1;
  while (scan < source.length && /\s/.test(source[scan]!)) scan++;
  if (source[scan] === ";") scan++;

  const rest = source.slice(scan);
  const nextLine = rest.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return /^\w+\??:/.test(nextLine);
}

export function validateBespokeSource(source: string, typeName: string): string | null {
  const trimmed = source.trim();
  if (!trimmed.includes("export default")) {
    return "Missing export default";
  }
  if (!trimmed.startsWith('"use client"') && !trimmed.startsWith("'use client'")) {
    return 'Missing "use client" directive';
  }
  const bodyWithoutDirective = trimmed.replace(/^["']use client["'];?\s*\n?/, "");
  if (/^\s*use\s+client\s*;?\s*$/im.test(bodyWithoutDirective)) {
    return "Invalid bare use client directive (must be quoted)";
  }
  if (/export default function \w+\(\s*props\s*\)/.test(trimmed)) {
    return "Untyped props parameter";
  }
  if (/<SectionLabel\s+[^>]*(className|id)=/.test(trimmed)) {
    return "SectionLabel does not accept className or id";
  }
  if (/<MonoTag\s+[^>]*className=/.test(trimmed)) {
    return "MonoTag does not accept className";
  }
  if (/<PrimaryButton\s+[^>]*className=/.test(trimmed)) {
    return "PrimaryButton does not accept className";
  }
  const typeMatches = trimmed.match(new RegExp(`type\\s+${typeName}\\s*=`, "g"));
  if (typeMatches && typeMatches.length > 1) {
    return `Duplicate ${typeName} type blocks`;
  }
  if (hasOrphanTypeFields(trimmed, typeName)) {
    return `Orphan ${typeName} fields outside type block`;
  }
  if (/import\s+\{[^}]*\bReact\b[^}]*\}\s+from\s+['"]react['"]/.test(trimmed)) {
    return "Invalid React named import";
  }
  if (/\bprops\.cta\.[a-zA-Z]/.test(trimmed.replace(/\bprops\.cta\?\./g, ""))) {
    return "Unsafe optional props.cta access";
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) return `Forbidden pattern: ${pattern}`;
  }
  const importLines = trimmed.split("\n").filter((l) => l.trim().startsWith("import "));
  for (const line of importLines) {
    const fromPrimitivesOrSections =
      line.includes("@/components/primitives") || line.includes("@/components/sections");
    if (fromPrimitivesOrSections && !line.includes("{")) {
      return `Default import not allowed for primitives — use named imports: ${line.trim()}`;
    }
    const ok =
      line.includes("from \"react\"") ||
      line.includes("from 'react'") ||
      line.includes("framer-motion") ||
      fromPrimitivesOrSections;
    if (!ok) return `Disallowed import: ${line.trim()}`;
  }
  if (trimmed.length > 12_000) return "Source too large";
  const importError = validateBespokeImports(trimmed);
  if (importError) return importError;
  return null;
}

export function checkBespokeSyntax(source: string): string | null {
  if (/import\s+\{[^}]*\bReact\b[^}]*\}\s+from\s+['"]react['"]/.test(source)) {
    return "Invalid React named import";
  }
  try {
    transformSync(source, { loader: "tsx", format: "esm", target: "es2020" });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function componentNameForSection(sectionId: string): { componentName: string; fileName: string } {
  const base = sectionId
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return { componentName: `Custom${base}`, fileName: `Custom${base}.tsx` };
}

/** Infer a lenient prop type string from the section's already-validated props JSON —
 *  this is the type contract the bespoke component must accept. `id` is always included
 *  since assemble-project.ts merges it into customCodegen sections' props at render time. */
/** Nested object/array-of-object types render fully inline (single line) — never multi-line.
 *  Only the outermost type produced by objectTypeLiteral() spans multiple lines. This keeps
 *  exactly one line in the whole type block ending in "};" (the real close), which
 *  stripOrphanTypeFields()/replaceTypeBlock() rely on to find the type's true end — a nested
 *  multi-line block would introduce an inner "};"-looking line and corrupt the type. */
function inlineTsType(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return "unknown[]";
    return `${inlineTsType(value[0])}[]`;
  }
  if (typeof value === "object") return inlineObjectType(value as Record<string, unknown>);
  return "unknown";
}

function inlineObjectType(obj: Record<string, unknown>): string {
  const fields = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      return `${key}?: ${inlineTsType(v)}`;
    });
  if (fields.length === 0) return "Record<string, unknown>";
  return `{ ${fields.join("; ")} }`;
}

function objectTypeLiteral(obj: Record<string, unknown>, indent: string): string {
  const lines = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      return `${indent}${key}?: ${inlineTsType(v)};`;
    });
  if (lines.length === 0) return "Record<string, unknown>";
  return `{\n${lines.join("\n")}\n${indent.slice(2)}}`;
}

export function inferPropsType(props: Record<string, unknown>, typeName: string): string {
  const withId = { id: (props as { id?: unknown }).id ?? "", ...props };
  return `type ${typeName} = ${objectTypeLiteral(withId, "  ")};`;
}

function buildUserPrompt(
  ctx: SiteContext,
  instance: SectionInstance,
  componentName: string,
  typeName: string,
  typeBlock: string,
  priorError?: string
): string {
  const errorBlock = priorError
    ? `\n\nPrevious code failed validation: ${priorError}\nFix and return valid TSX only.`
    : "";
  return `Business: ${ctx.businessName}
Mood: ${ctx.designSystem.mood}
Vertical: ${ctx.designSystem.vertical}
Section kind: ${instance.templateId}
Section intent: ${instance.intent || "engaging section for this business"}
Component name: ${componentName}
Type name: ${typeName}

Props type (match exactly — do not add or remove fields):
${typeBlock}

Props JSON (render exactly this data, every array item):
${JSON.stringify(instance.props, null, 2)}${errorBlock}`;
}

export async function generateBespokeSection(
  ctx: SiteContext,
  instance: SectionInstance
): Promise<CustomSectionCodegen | null> {
  if (!llm.isAvailable) {
    requireLlm("bespoke section codegen");
    return null;
  }

  const { componentName, fileName } = componentNameForSection(instance.id);
  const typeName = `${componentName}Props`;
  const typeBlock = inferPropsType(instance.props, typeName);

  let source: string | null = null;
  try {
    const raw = await llm.chat(
      BESPOKE_SECTION_PROMPT,
      buildUserPrompt(ctx, instance, componentName, typeName, typeBlock),
      { temperature: 0.5, tokenRole: "composition", model: llm.getBespokeCodegenModel(), queue: "codegen" }
    );
    source = sanitizeBespokeSource(raw, typeName, typeBlock);
  } catch (err) {
    if (strictLlmRequired()) handleLlmFailure("bespoke section codegen", err);
    recordFallback("section_codegen");
    pipelineLog(`[pipeline] Bespoke codegen LLM failed for ${instance.id}; using template fallback`);
    return null;
  }

  let validationError = validateBespokeSource(source, typeName);
  if (!validationError) validationError = checkBespokeSyntax(source);

  if (validationError) {
    try {
      const retryRaw = await llm.chat(
        BESPOKE_SECTION_PROMPT,
        buildUserPrompt(ctx, instance, componentName, typeName, typeBlock, validationError),
        { temperature: 0.3, tokenRole: "composition", model: llm.getBespokeCodegenModel(), queue: "codegen" }
      );
      source = sanitizeBespokeSource(retryRaw, typeName, typeBlock);
      validationError = validateBespokeSource(source, typeName);
      if (!validationError) validationError = checkBespokeSyntax(source);
    } catch {
      /* fall through to template fallback */
    }
  }

  if (validationError) {
    pipelineLog(
      `[pipeline] Bespoke codegen validation failed for ${instance.id} (${validationError}); using template fallback`
    );
    recordFallback("section_codegen");
    return null;
  }

  pipelineLog(`[pipeline] Bespoke section codegen: ${componentName}`);
  const renamed = source.replace(/export default function \w+/, `export default function ${componentName}`);
  return { componentName, fileName, source: renamed };
}
