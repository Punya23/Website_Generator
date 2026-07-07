import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { ReactPage, SiteContext, SiteTheme, ChromeSpec, SiteMotionPlan } from "../types.js";
import { getTemplate } from "../section-templates/registry.js";
import { sanitizePropsForCodegen } from "./sanitize-props.js";
import { normalizePageCodegenProps } from "../agents/page-codegen-normalize.js";
import { normalizeMotionPlan, resolveMotionPreset } from "../motion/presets.js";
import type { MotionPreset } from "../types.js";
import { generateFontLayout } from "./font-codegen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_LIBRARY = path.join(__dirname, "component-library");

const NEXT_VERSION = "14.2.18";

/** Next's platform-specific SWC binary. Kept as a REGULAR dependency (not optional) so
 *  `npm install` reliably fetches it — when it's optional, npm frequently skips it, and Next
 *  then re-patches it at build time on every single build ("Found lockfile missing swc
 *  dependencies, patching…"), which is both slow and an intermittent source of runtime failures
 *  during static-export prerendering. The generated project is only ever built on the same
 *  machine that generated it, so pinning to the current platform is safe. */
function platformSwcDependency(): Record<string, string> {
  if (process.platform === "darwin") {
    return { [process.arch === "arm64" ? "@next/swc-darwin-arm64" : "@next/swc-darwin-x64"]: NEXT_VERSION };
  }
  if (process.platform === "linux") {
    return { [process.arch === "arm64" ? "@next/swc-linux-arm64-gnu" : "@next/swc-linux-x64-gnu"]: NEXT_VERSION };
  }
  if (process.platform === "win32") {
    return { "@next/swc-win32-x64-msvc": NEXT_VERSION };
  }
  return {};
}

function serializeProps(props: Record<string, unknown>): string {
  return JSON.stringify(props, null, 2);
}

function pageComponentName(slug: string): string {
  if (slug === "home") return "HomePage";
  return slug
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") + "Page";
}

function hasResolvedMedia(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasResolvedMedia(item));
  const obj = value as Record<string, unknown>;
  if (typeof obj.src === "string" && obj.src.startsWith("https://")) return true;
  return Object.values(obj).some((v) => hasResolvedMedia(v));
}

function propsForCodegen(templateId: string, raw: Record<string, unknown>): Record<string, unknown> {
  const normalized = hasResolvedMedia(raw)
    ? raw
    : normalizePageCodegenProps(templateId, raw);
  const template = getTemplate(templateId);
  if (!template) return sanitizePropsForCodegen(normalized);
  const parsed = template.propsSchema.safeParse(normalized);
  const out = parsed.success ? (parsed.data as Record<string, unknown>) : normalized;
  return sanitizePropsForCodegen(out);
}

function writePageTsx(page: ReactPage): string {
  const stdImports = new Set<string>();
  const customImportLines: string[] = [];

  for (const section of page.sections) {
    if (section.customCodegen) {
      const mod = section.customCodegen.fileName.replace(/\.tsx$/, "");
      customImportLines.push(
        `import ${section.customCodegen.componentName} from "@/components/custom/${mod}";`
      );
    } else {
      const t = getTemplate(section.templateId);
      if (t) stdImports.add(t.componentName);
    }
  }

  const importLines = [
    stdImports.size > 0
      ? `import { ${[...stdImports].join(", ")} } from "@/components/sections";`
      : "",
    ...customImportLines,
  ].filter(Boolean);

  const sectionsJsx = page.sections
    .map((s) => {
      const name =
        s.customCodegen?.componentName ??
        getTemplate(s.templateId)?.componentName ??
        "IntroStatement";
      const props = propsForCodegen(s.templateId, s.props);
      if (s.customCodegen) {
        const merged = { ...props, id: s.id };
        return `      <${name} {...${JSON.stringify(merged)}} />`;
      }
      return `      <${name} id="${s.id}" {...${JSON.stringify(props)}} />`;
    })
    .join("\n");

  return `${importLines.join("\n")}

export default function ${pageComponentName(page.slug)}() {
  return (
    <>
${sectionsJsx}
    </>
  );
}
`;
}

function radiusValue(scale: SiteTheme["radiusScale"]): string {
  switch (scale) {
    case "sharp":
      return "0.25rem";
    case "soft":
      return "0.5rem";
    case "pill":
      return "9999px";
    case "rounded":
    default:
      return "0.75rem";
  }
}

function shadowValue(depth: SiteTheme["shadowDepth"]): string {
  switch (depth) {
    case "flat":
      return "none";
    case "elevated":
      return "0 12px 40px rgba(0, 0, 0, 0.12)";
    case "dramatic":
      return "0 24px 64px rgba(0, 0, 0, 0.22)";
    case "soft":
    default:
      return "0 4px 24px rgba(0, 0, 0, 0.06)";
  }
}

export function themeCssVars(theme: SiteTheme): string {
  const c = theme.colors;
  const gap =
    theme.sectionGapMode === "tight" ? "3.5rem" : theme.sectionGapMode === "airy" ? "7rem" : "5rem";
  const navBlur =
    theme.navTreatment === "glass-dark" || theme.navTreatment === "glass-light" ? "14px" : "0px";
  return `:root {
  --color-bg: ${c.bg};
  --color-surface: ${c.surface};
  --color-text: ${c.text};
  --color-muted: ${c.muted};
  --color-accent: ${c.accent};
  --color-border: color-mix(in srgb, ${c.text} 12%, transparent);
  --color-nav: ${c.navBg};
  --color-nav-text: ${c.navText ?? c.text};
  --color-nav-muted: ${c.navMuted ?? c.muted};
  --color-nav-active: ${c.navActiveBg ?? c.accent};
  --color-nav-active-text: ${c.navActiveText ?? "#fff"};
  --color-gradient-from: ${c.gradientFrom};
  --color-gradient-to: ${c.gradientTo};
  --nav-blur: ${navBlur};
  --max-content: ${theme.layout?.maxWidth ?? "1200px"};
  --section-gap: ${gap};
  --radius: ${radiusValue(theme.radiusScale)};
  --shadow: ${shadowValue(theme.shadowDepth)};
  --font-display: '${theme.fontHeading}', Georgia, serif;
  --font-body: '${theme.fontBody}', system-ui, sans-serif;
${generateFontLayout(theme).typeScaleCss.split("\n").map((l) => l).join("\n")}
}`;
}

function tailwindConfig(theme: SiteTheme): string {
  return `import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        text: "var(--color-text)",
        muted: "var(--color-muted)",
        accent: "var(--color-accent)",
        border: "var(--color-border)",
        nav: "var(--color-nav)",
        "nav-text": "var(--color-nav-text)",
        "nav-muted": "var(--color-nav-muted)",
        "nav-active": "var(--color-nav-active)",
        "nav-active-text": "var(--color-nav-active-text)",
      },
      maxWidth: { content: "var(--max-content)" },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
    },
  },
  plugins: [],
};

export default config;
`;
}

function layoutTsx(ctx: SiteContext, pages: ReactPage[]): string {
  const links = pages.map((p) => ({
    slug: p.slug,
    label: p.navLabel ?? p.title,
  }));
  const fonts = generateFontLayout(ctx.designSystem);
  const chrome = ctx.chromeSpec ?? defaultChromeSpec(ctx, links);
  const motionPlanRaw = ctx.motionPlan;
  const motionPreset: MotionPreset = resolveMotionPreset(
    motionPlanRaw?.globalPreset ?? ctx.designSystem.motionPreset
  );
  const immersive = chrome.immersive ?? { smoothScroll: false, grainOverlay: false };
  const announcement = chrome.announcement;
  const stickyCta = chrome.stickyMobileCta ?? {
    label: chrome.footer.ctaLabel,
    href: chrome.footer.ctaHref,
  };
  const newsletter = chrome.newsletter;

  const linkGroups = (chrome.footer.linkGroups ?? []).map((g) => ({
    label: g.label,
    slugs: g.slugs.map((slug) => {
      const page = pages.find((p) => p.slug === slug);
      return { slug, label: page?.navLabel ?? page?.title ?? slug };
    }),
  }));

  const motionPlanJson = motionPlanRaw
    ? JSON.stringify(normalizeMotionPlan(motionPlanRaw as SiteMotionPlan)).replace(/</g, "\\u003c")
    : "null";

  const smoothScroll = immersive.smoothScroll === true;
  const grainOverlay = immersive.grainOverlay === true;

  return `import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { MotionProvider } from "@/components/MotionProvider";
${fonts.imports}
${smoothScroll ? 'import { SmoothScroll } from "@/components/SmoothScroll";' : ""}
${announcement ? 'import { AnnouncementBar } from "@/components/AnnouncementBar";' : ""}
import { StickyMobileCta } from "@/components/StickyMobileCta";

${fonts.fontVars}

export const metadata: Metadata = {
  title: "${ctx.businessName.replace(/"/g, '\\"')}",
  description: "${ctx.expandedBrief.elevatorPitch.slice(0, 140).replace(/"/g, '\\"')}",
};

const navLinks = ${JSON.stringify(links, null, 2)};
const footerLinkGroups = ${JSON.stringify(linkGroups, null, 2)};
const motionPlan = ${motionPlanJson === "null" ? "null" : motionPlanJson};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const site = (
    <MotionProvider preset="${motionPreset}" plan={motionPlan}>
      ${announcement ? `<AnnouncementBar message="${announcement.message.replace(/"/g, '\\"')}"${announcement.href ? ` href="${announcement.href.replace(/"/g, '\\"')}"` : ""} />` : ""}
      <SiteNav businessName="${ctx.businessName.replace(/"/g, '\\"')}" links={navLinks} />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <main id="main-content">{children}</main>
      <SiteFooter
        businessName="${ctx.businessName.replace(/"/g, '\\"')}"
        mood="${ctx.designSystem.mood.replace(/"/g, '\\"')}"
        tagline="${(chrome.footer.tagline ?? ctx.expandedBrief.tagline).replace(/"/g, '\\"')}"
        ctaLabel="${chrome.footer.ctaLabel.replace(/"/g, '\\"')}"
        ctaHref="${chrome.footer.ctaHref.replace(/"/g, '\\"')}"
        links={navLinks}
        layout="${chrome.footer.layout}"
        linkGroups={footerLinkGroups}
        showMood={${chrome.footer.showMood}}
        ${newsletter ? `newsletter={${JSON.stringify(newsletter)}}` : ""}
      />
      <StickyMobileCta label="${stickyCta.label.replace(/"/g, '\\"')}" href="${stickyCta.href.replace(/"/g, '\\"')}" />
    </MotionProvider>
  );

  return (
    <html lang="en">
      <body
        className={\`font-body relative ${fonts.bodyClass}\`}
        data-page-tone="${ctx.designSystem.pageTone ?? "light"}"
        data-nav-treatment="${ctx.designSystem.navTreatment ?? "solid"}"
        data-motion-preset="${motionPreset}"
      >
        ${grainOverlay ? `<div className="grain-overlay pointer-events-none fixed inset-0 z-[100]" aria-hidden />` : ""}
        ${smoothScroll ? "<SmoothScroll>{site}</SmoothScroll>" : "{site}"}
      </body>
    </html>
  );
}
`;
}

function defaultChromeSpec(
  ctx: SiteContext,
  links: Array<{ slug: string; label: string }>
): ChromeSpec {
  return {
    footer: {
      layout: "two-column",
      tagline: ctx.expandedBrief.tagline,
      ctaLabel: ctx.expandedBrief.primaryCta,
      ctaHref: "/contact",
      showMood: false,
      linkGroups: [{ label: "Explore", slugs: links.map((l) => l.slug) }],
    },
    nav: { compactOnScroll: false, shadowOnScroll: false },
    immersive: { smoothScroll: false, grainOverlay: false },
  };
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export interface CodegenOptions {
  /** When set (e.g. `/preview`), static export assets and links work under a subpath. */
  basePath?: string;
}

export interface CodegenResult {
  projectPath: string;
  outPath: string;
}

export async function generateReactProject(
  ctx: SiteContext,
  reactPages: Record<string, ReactPage>,
  outputDir: string,
  options: CodegenOptions = {}
): Promise<CodegenResult> {
  const projectPath = path.resolve(outputDir);
  await fs.rm(projectPath, { recursive: true, force: true });
  await fs.mkdir(projectPath, { recursive: true });

  await copyDir(COMPONENT_LIBRARY, projectPath);

  const pages = Object.values(reactPages);
  const themeOverride = themeCssVars(ctx.designSystem);
  const globalsPath = path.join(projectPath, "app", "globals.css");
  let globals = await fs.readFile(globalsPath, "utf8");
  globals = globals.replace(/:root \{[\s\S]*?\}/, themeOverride);
  await fs.writeFile(globalsPath, globals, "utf8");

  await fs.writeFile(path.join(projectPath, "tailwind.config.ts"), tailwindConfig(ctx.designSystem), "utf8");

  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify(
      {
        name: "generated-site",
        private: true,
        scripts: {
          dev: "next dev -p 3850",
          build: "next build",
          start: "next start -p 3850",
          preview: "node scripts/serve-static.mjs",
        },
        dependencies: {
          next: NEXT_VERSION,
          react: "^18.3.0",
          "react-dom": "^18.3.0",
          "framer-motion": "^11.0.0",
          lenis: "^1.1.0",
          "embla-carousel-react": "^8.5.0",
          ...platformSwcDependency(),
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          "@types/react": "^18.3.0",
          "@types/react-dom": "^18.3.0",
          autoprefixer: "^10.4.0",
          postcss: "^8.4.0",
          tailwindcss: "^3.4.0",
          typescript: "^5.7.0",
          serve: "^14.2.6",
        },
      },
      null,
      2
    ),
    "utf8"
  );

  const basePath = options.basePath?.replace(/\/$/, "") || "";
  const basePathConfig = basePath
    ? `  basePath: ${JSON.stringify(basePath)},
  assetPrefix: ${JSON.stringify(basePath)},
  trailingSlash: true,`
    : "";

  await fs.writeFile(
    path.join(projectPath, "next.config.mjs"),
    `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
${basePathConfig}
};
export default nextConfig;
`,
    "utf8"
  );

  await fs.writeFile(
    path.join(projectPath, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        exclude: ["node_modules"],
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    path.join(projectPath, "postcss.config.mjs"),
    `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };`,
    "utf8"
  );

  await fs.writeFile(path.join(projectPath, "app", "layout.tsx"), layoutTsx(ctx, pages), "utf8");

  for (const page of pages) {
    for (const section of page.sections) {
      if (section.customCodegen) {
        const customDir = path.join(projectPath, "components", "custom");
        await fs.mkdir(customDir, { recursive: true });
        await fs.writeFile(
          path.join(customDir, section.customCodegen.fileName),
          section.customCodegen.source,
          "utf8"
        );
      }
    }
  }

  for (const page of pages) {
    const dir =
      page.slug === "home"
        ? path.join(projectPath, "app")
        : path.join(projectPath, "app", page.slug);
    await fs.mkdir(dir, { recursive: true });
    const file = page.slug === "home" ? "page.tsx" : "page.tsx";
    await fs.writeFile(path.join(dir, file), writePageTsx(page), "utf8");
  }

  await fs.mkdir(path.join(projectPath, "lib"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "lib", "site-data.json"),
    JSON.stringify(
      {
        businessName: ctx.businessName,
        pages: reactPages,
        motionPlan: ctx.motionPlan,
        layoutPlan: ctx.layoutPlan,
        chromeSpec: ctx.chromeSpec,
      },
      null,
      2
    ),
    "utf8"
  );

  return { projectPath, outPath: path.join(projectPath, "out") };
}

export { buildReactProject } from "./build-project.js";
