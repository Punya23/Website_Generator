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

  const gap = theme.sectionGapMode ?? "normal";
  const heroSize =
    gap === "airy" ? "clamp(3rem, 8vw, 5.5rem)" : gap === "tight" ? "clamp(2rem, 5vw, 3.5rem)" : "clamp(2.5rem, 6vw, 4.5rem)";
  const sectionSize =
    gap === "airy" ? "clamp(2rem, 4vw, 3.25rem)" : gap === "tight" ? "clamp(1.5rem, 3vw, 2.25rem)" : "clamp(1.75rem, 3.5vw, 2.75rem)";
  const labelSize = gap === "airy" ? "0.8rem" : "0.75rem";

  return {
    imports,
    fontVars: instances,
    bodyClass: `\${fontDisplay.variable} \${fontBody.variable}`,
    typeScaleCss: `  --text-hero: ${heroSize};
  --text-section: ${sectionSize};
  --text-label: ${labelSize};`,
  };
}
