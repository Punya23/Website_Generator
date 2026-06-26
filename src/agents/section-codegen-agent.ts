import type { CustomSectionCodegen, SectionInstance, SiteContext } from "../types.js";
import { transformSync } from "esbuild";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";
import { pipelineLog } from "../util/pipeline-log.js";

import { heroVariantShellSource } from "../section-templates/hero-variants.js";

const HERO_TEMPLATES = new Set([
  "hero_editorial",
  "hero_split_cinematic",
  "hero_spotlight",
  "hero_video",
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

const CUSTOM_HERO_PROMPT = `You generate ONE bespoke React hero section for a premium marketing site.

Output ONLY valid TSX source — no markdown fences, no explanation.

Rules:
- First line MUST be exactly: "use client";
- Do NOT repeat use client anywhere else (no bare use client; without quotes).
- Import only from "react", "framer-motion", and "@/components/primitives" (Container, DisplayHeading, MonoTag, PrimaryButton, Reveal, SectionLabel).
- Do NOT import React (no default or named React import). Use named hooks from "react" only when needed (e.g. useRef).
- Primitives: SectionLabel and MonoTag only accept children (no className/id). PrimaryButton accepts href + children only. Use wrapper <div> or <section> for layout classes.
- Export default function CustomHomeHero(props: HeroProps) — include the HeroProps type block before the component.
- Use semantic Tailwind tokens: bg-bg, text-text, text-muted, bg-accent, text-white, border-border.
- Editorial asymmetry: offset headline, optional parallax image via useScroll/useTransform.
- One primary CTA from props.cta.
- No external URLs except props.image?.src in <img>.
- Keep under 120 lines.`;

export function shouldCodegenCustomHero(
  ctx: SiteContext,
  pageSlug: string,
  section: { templateId: string; id: string },
  sectionIndex: number
): boolean {
  if (pageSlug !== "home" || sectionIndex !== 0) return false;
  if (!HERO_TEMPLATES.has(section.templateId)) return false;

  if (process.env.CUSTOM_HERO_CODEGEN !== "1") return false;

  return true;
}

const USE_CLIENT_LINE = /^\s*("use client"|'use client'|use client)\s*;?\s*$/i;

const HERO_PROPS_TYPE = `type HeroProps = {
  id?: string;
  label?: string;
  headline?: string;
  subcopy?: string;
  body?: string;
  image?: { src?: string; alt?: string };
  video?: { poster?: { src?: string; alt?: string } };
  cta?: { label: string; href?: string };
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
  mediaPosition?: "background" | "left" | "right";
};`;

const HERO_PROPS_TYPE_START = /type\s+HeroProps\s*=\s*\{/;

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

function replaceHeroPropsTypeBlock(body: string): string {
  const match = HERO_PROPS_TYPE_START.exec(body);
  if (!match) return body;

  const braceStart = body.indexOf("{", match.index);
  const braceEnd = findMatchingBraceClose(body, braceStart);
  if (braceEnd < 0) return body;

  let end = braceEnd + 1;
  while (end < body.length && /\s/.test(body[end]!)) end++;
  if (body[end] === ";") end++;

  return body.slice(0, match.index) + HERO_PROPS_TYPE + body.slice(end);
}

function stripOrphanTypeFields(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let afterHeroPropsClose = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^type\s+HeroProps\s*=/.test(trimmed)) {
      afterHeroPropsClose = false;
      out.push(line);
      continue;
    }
    if (afterHeroPropsClose && /^\w+\?:/.test(trimmed)) {
      continue;
    }
    if (trimmed === "};" && out.some((l) => /^type\s+HeroProps\s*=/.test(l.trim()))) {
      afterHeroPropsClose = true;
    } else if (trimmed && !/^\w+\?:/.test(trimmed)) {
      afterHeroPropsClose = false;
    }
    out.push(line);
  }

  return out.join("\n");
}

function cleanupTrailingHeroPropsGarbage(body: string): string {
  const idx = body.indexOf(HERO_PROPS_TYPE);
  if (idx < 0) return body;

  const head = body.slice(0, idx + HERO_PROPS_TYPE.length);
  let tail = body.slice(idx + HERO_PROPS_TYPE.length);

  while (/^\s*\w+\?:[^\n]*\n/.test(tail) || /^\s*\};\s*\n/.test(tail)) {
    tail = tail
      .replace(/^\s*\w+\?:[^\n]*\n/, "")
      .replace(/^\s*\};\s*\n/, "");
  }

  return head + tail;
}

function normalizeHeroPropsType(body: string): string {
  let out = body;
  if (HERO_PROPS_TYPE_START.test(out)) {
    out = replaceHeroPropsTypeBlock(out);
  }
  return stripOrphanTypeFields(out);
}

function normalizeHeroImports(body: string): string {
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

function ensureTypedHeroProps(body: string): string {
  let out = normalizeHeroImports(body);
  out = normalizeHeroPropsType(out);

  if (!/\bHeroProps\b/.test(out)) {
    const lines = out.split("\n");
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim().startsWith("import ")) insertAt = i + 1;
    }
    lines.splice(insertAt, 0, "", HERO_PROPS_TYPE);
    out = lines.join("\n");
  }

  out = out.replace(
    /export default function (Custom\w+)\(\s*props\s*(?::\s*HeroProps)?\s*\)/g,
    "export default function $1(props: HeroProps)"
  );

  return cleanupTrailingHeroPropsGarbage(out);
}

export function sanitizeCustomHeroSource(source: string): string {
  const withoutFences = source
    .trim()
    .replace(/^```(?:tsx|typescript)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  const body = withoutFences
    .split("\n")
    .filter((line) => !USE_CLIENT_LINE.test(line))
    .join("\n")
    .replace(/^\n+/, "");

  return `"use client";\n\n${ensureTypedHeroProps(body)}`;
}

export function validateCustomHeroSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed.includes("export default")) {
    return "Missing export default";
  }
  if (!trimmed.startsWith('"use client"') && !trimmed.startsWith("'use client'")) {
    return 'Missing "use client" directive';
  }
  if (/^use client\s*;?\s*$/im.test(trimmed)) {
    return "Invalid bare use client directive (must be quoted)";
  }
  if (/export default function Custom\w+\(\s*props\s*\)/.test(trimmed)) {
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
  if (
    /type HeroProps\s*=\s*\{/.test(trimmed) &&
    !/type HeroProps\s*=\s*\{[\s\S]*?id\??:\s*string/.test(trimmed)
  ) {
    return "HeroProps missing id field";
  }
  const heroPropsMatches = trimmed.match(/type\s+HeroProps\s*=/g);
  if (heroPropsMatches && heroPropsMatches.length > 1) {
    return "Duplicate HeroProps type blocks";
  }
  if (hasOrphanHeroTypeFields(trimmed)) {
    return "Orphan HeroProps fields outside type block";
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
    const ok =
      line.includes("from \"react\"") ||
      line.includes("from 'react'") ||
      line.includes("framer-motion") ||
      line.includes("@/components/primitives") ||
      line.includes("@/components/sections");
    if (!ok) return `Disallowed import: ${line.trim()}`;
  }
  if (trimmed.length > 12_000) return "Source too large";
  return null;
}

function hasOrphanHeroTypeFields(source: string): boolean {
  const match = HERO_PROPS_TYPE_START.exec(source);
  if (!match) return false;

  const braceStart = source.indexOf("{", match.index);
  const braceEnd = findMatchingBraceClose(source, braceStart);
  if (braceEnd < 0) return false;

  let scan = braceEnd + 1;
  while (scan < source.length && /\s/.test(source[scan]!)) scan++;
  if (source[scan] === ";") scan++;

  const rest = source.slice(scan);
  const nextLine = rest.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return /^\w+\?:/.test(nextLine);
}

export function checkCustomHeroSyntax(source: string): string | null {
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

function mockCustomHeroSource(_props: Record<string, unknown>): string {
  return `"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Container, DisplayHeading, MonoTag, PrimaryButton, Reveal } from "@/components/primitives";

type HeroProps = {
  id?: string;
  label?: string;
  headline?: string;
  subcopy?: string;
  body?: string;
  image?: { src?: string; alt?: string };
  cta?: { label: string; href?: string };
};

export default function CustomHomeHero(props: HeroProps) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const sub = props.subcopy ?? props.body ?? "";

  return (
    <section id={props.id} ref={ref} className="relative min-h-[88vh] overflow-hidden bg-bg">
      <motion.div style={{ y }} className="absolute inset-0 opacity-90">
        {props.image?.src ? (
          <img src={props.image.src} alt={props.image.alt ?? ""} className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-accent/10" />
        )}
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-transparent" />
      <Container className="relative z-10 flex min-h-[88vh] items-end pb-20 pt-32 md:items-center md:pb-28">
        <div className="max-w-2xl md:translate-x-6">
          <Reveal>
            {props.label ? <MonoTag>{props.label}</MonoTag> : null}
            <DisplayHeading className="text-display leading-tight">{props.headline ?? "Welcome"}</DisplayHeading>
            {sub ? <p className="mt-5 max-w-lg text-lg text-muted">{sub}</p> : null}
            {props.cta ? (
              <div className="mt-8">
                <PrimaryButton href={props.cta?.href ?? "/contact"}>{props.cta?.label}</PrimaryButton>
              </div>
            ) : null}
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
`;
}

function componentNameForSection(sectionId: string): { componentName: string; fileName: string } {
  const base = sectionId
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return { componentName: `Custom${base}`, fileName: `Custom${base}.tsx` };
}

export async function generateCustomHeroSection(
  ctx: SiteContext,
  instance: SectionInstance
): Promise<CustomSectionCodegen | null> {
  const props = instance.props;
  const { componentName, fileName } = componentNameForSection(instance.id);

  let source: string | null = null;

  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        CUSTOM_HERO_PROMPT,
        `Business: ${ctx.businessName}
Mood: ${ctx.designSystem.mood}
Vertical: ${ctx.designSystem.vertical}
Props JSON:
${JSON.stringify(props, null, 2)}`,
        { temperature: 0.5, maxTokens: 4096, model: llm.getCompositionModel() }
      );
      source = sanitizeCustomHeroSource(raw);
    } catch {
      if (!allowMocks()) pipelineLog("[pipeline] Custom hero codegen LLM failed; using template fallback");
    }
  } else if (!allowMocks()) {
    requireLlm("custom hero codegen");
  }

  if (!source) {
    source = heroVariantShellSource(instance.templateId);
  } else {
    source = sanitizeCustomHeroSource(source);
  }

  let validationError = validateCustomHeroSource(source);
  if (!validationError) {
    validationError = checkCustomHeroSyntax(source);
  }
  if (validationError) {
    pipelineLog(`[pipeline] Custom hero validation failed (${validationError}); using variant shell`);
    source = heroVariantShellSource(instance.templateId);
    validationError = validateCustomHeroSource(source);
    if (!validationError) validationError = checkCustomHeroSyntax(source);
    if (validationError) {
      source = mockCustomHeroSource(props);
      validationError = validateCustomHeroSource(source);
      if (!validationError) validationError = checkCustomHeroSyntax(source);
    }
    if (validationError) return null;
  }

  pipelineLog(`[pipeline] Custom hero codegen: ${componentName}`);
  const renamed = source.replace(
    /export default function Custom\w+/,
    `export default function ${componentName}`
  );
  return { componentName, fileName, source: renamed };
}
