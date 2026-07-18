import type { SiteTheme } from "../types.js";

const NEXT_FONT_EXPORTS: Record<string, string> = {
  Inter: "Inter",
  "DM Sans": "DM_Sans",
  "Plus Jakarta Sans": "Plus_Jakarta_Sans",
  "Playfair Display": "Playfair_Display",
  "Cormorant Garamond": "Cormorant_Garamond",
  Outfit: "Outfit",
  "IBM Plex Mono": "IBM_Plex_Mono",
  Lato: "Lato",
  Montserrat: "Montserrat",
  Raleway: "Raleway",
  Merriweather: "Merriweather",
  "Source Sans 3": "Source_Sans_3",
  Poppins: "Poppins",
};

/** Weights that exist on the font — next/font errors if you request missing weights. */
const FONT_WEIGHTS: Record<string, string[]> = {
  Lato: ["300", "400", "700", "900"],
  Inter: ["400", "500", "600", "700"],
  "DM Sans": ["400", "500", "600", "700"],
  "Plus Jakarta Sans": ["400", "500", "600", "700"],
  "Playfair Display": ["400", "500", "600", "700"],
  "Cormorant Garamond": ["400", "500", "600", "700"],
  Outfit: ["400", "500", "600", "700"],
  "IBM Plex Mono": ["400", "500", "600", "700"],
  Montserrat: ["400", "500", "600", "700"],
  Raleway: ["400", "500", "600", "700"],
  Merriweather: ["400", "700"],
  "Source Sans 3": ["400", "500", "600", "700"],
  Poppins: ["400", "500", "600", "700"],
};

function exportName(family: string): string {
  return NEXT_FONT_EXPORTS[family] ?? family.replace(/\s+/g, "_");
}

function weightsFor(family: string): string[] {
  return FONT_WEIGHTS[family] ?? ["400", "700"];
}

function fontInstance(exportId: string, family: string, cssVar: string, constName: string): string {
  const weights = weightsFor(family).map((w) => `"${w}"`).join(", ");
  return `const ${constName} = ${exportId}({ subsets: ["latin"], weight: [${weights}], variable: "${cssVar}", display: "swap" });`;
}

export function generateFontLayout(theme: SiteTheme): {
  imports: string;
  fontVars: string;
  bodyClass: string;
  typeScaleCss: string;
} {
  const heading = theme.fontHeading;
  const body = theme.fontBody;
  const hExport = exportName(heading);
  const bExport = exportName(body);
  const same = hExport === bExport;

  const imports = same
    ? `import { ${hExport} } from "next/font/google";`
    : `import { ${hExport}, ${bExport} } from "next/font/google";`;

  const instances = same
    ? `${fontInstance(hExport, heading, "--font-display", "fontDisplay")}
${fontInstance(hExport, body, "--font-body", "fontBody")}`
    : `${fontInstance(hExport, heading, "--font-display", "fontDisplay")}
${fontInstance(bExport, body, "--font-body", "fontBody")}`;

  return {
    imports,
    fontVars: instances,
    bodyClass: `\${fontDisplay.variable} \${fontBody.variable}`,
    typeScaleCss: typeScaleTokens(theme),
  };
}

/**
 * A real modular type scale — the single strongest "premium" signal (research: Framer/Stripe use
 * dramatic, consistent display↔body size contrast derived from one ratio). Previously the pipeline
 * emitted --text-hero/section/label tokens that no component consumed and rendered every heading at
 * one timid clamp, so nothing read as a focal point. Now h1≫h2>h3 with a dramatic top end, one
 * scale per site chosen by density/mood, consumed by the .text-h1/.text-h2/.text-h3 utilities.
 */
function typeScaleTokens(theme: SiteTheme): string {
  const gap = theme.sectionGapMode ?? "normal";
  // Ratio tier: airy/editorial → dramatic (~1.5), tight → compact (~1.25), else the 1.333 workhorse.
  const tier = gap === "airy" ? "dramatic" : gap === "tight" ? "compact" : "normal";

  const scales = {
    dramatic: {
      h1: "clamp(3rem, 8vw, 5.75rem)",
      h2: "clamp(2.125rem, 5vw, 3.5rem)",
      h3: "clamp(1.5rem, 3vw, 2.125rem)",
      display: "clamp(3.5rem, 9vw, 6.5rem)",
      label: "0.8rem",
    },
    normal: {
      h1: "clamp(2.75rem, 6vw, 4.5rem)",
      h2: "clamp(1.875rem, 4vw, 2.75rem)",
      h3: "clamp(1.375rem, 2.5vw, 1.75rem)",
      display: "clamp(3rem, 7vw, 5.25rem)",
      label: "0.75rem",
    },
    compact: {
      h1: "clamp(2.25rem, 5vw, 3.5rem)",
      h2: "clamp(1.625rem, 3.5vw, 2.25rem)",
      h3: "clamp(1.25rem, 2vw, 1.5rem)",
      display: "clamp(2.5rem, 6vw, 4rem)",
      label: "0.7rem",
    },
  } as const;

  const s = scales[tier];
  return `  --text-body: clamp(1rem, 0.955rem + 0.22vw, 1.0625rem);
  --text-display: ${s.display};
  --text-h1: ${s.h1};
  --text-h2: ${s.h2};
  --text-h3: ${s.h3};
  --text-label: ${s.label};
  --lh-display: 1.03;
  --lh-h1: 1.05;
  --lh-h2: 1.12;
  --lh-h3: 1.22;
  --tracking-display: -0.035em;
  --tracking-h2: -0.02em;
  --tracking-h3: -0.01em;
  /* Legacy aliases kept so any older reference still resolves */
  --text-hero: ${s.h1};
  --text-section: ${s.h2};`;
}
