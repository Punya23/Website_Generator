import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { ReactPage, SiteContext, SiteTheme } from "../types.js";
import { getTemplate } from "../section-templates/registry.js";
import { sanitizePropsForCodegen } from "./sanitize-props.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_LIBRARY = path.join(__dirname, "component-library");

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

function writePageTsx(page: ReactPage): string {
  const imports = new Set<string>();
  for (const section of page.sections) {
    const t = getTemplate(section.templateId);
    if (t) imports.add(t.componentName);
  }

  const importLine = `import { ${[...imports].join(", ")} } from "@/components/sections";`;
  const sectionsJsx = page.sections
    .map((s) => {
      const t = getTemplate(s.templateId);
      const name = t?.componentName ?? "IntroStatement";
      const props = sanitizePropsForCodegen(s.props);
      return `      <${name} id="${s.id}" {...${JSON.stringify(props)}} />`;
    })
    .join("\n");

  return `${importLine}

export default function ${pageComponentName(page.slug)}() {
  return (
    <>
${sectionsJsx}
    </>
  );
}
`;
}

function themeCssVars(theme: SiteTheme): string {
  const c = theme.colors;
  const gap =
    theme.sectionGapMode === "tight" ? "3.5rem" : theme.sectionGapMode === "airy" ? "7rem" : "5rem";
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
  --max-content: ${theme.layout?.maxWidth ?? "1200px"};
  --section-gap: ${gap};
  --font-display: '${theme.fontHeading}', Georgia, serif;
  --font-body: '${theme.fontBody}', system-ui, sans-serif;
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
  const fonts = encodeURIComponent(ctx.designSystem.fontHeading).replace(/%20/g, "+");
  const fontsBody = encodeURIComponent(ctx.designSystem.fontBody).replace(/%20/g, "+");

  return `import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  title: "${ctx.businessName.replace(/"/g, '\\"')}",
  description: "${ctx.expandedBrief.elevatorPitch.slice(0, 140).replace(/"/g, '\\"')}",
};

const navLinks = ${JSON.stringify(links, null, 2)};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=${fonts}:wght@500;600;700;800&family=${fontsBody}:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body">
        <SiteNav businessName="${ctx.businessName.replace(/"/g, '\\"')}" links={navLinks} />
        <main>{children}</main>
        <footer className="border-t border-border py-10 text-center text-sm text-muted">
          © {new Date().getFullYear()} ${ctx.businessName.replace(/"/g, '\\"')} · ${ctx.designSystem.mood.replace(/"/g, '\\"')}
        </footer>
      </body>
    </html>
  );
}
`;
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
        scripts: { dev: "next dev -p 3850", build: "next build", start: "next start -p 3850" },
        dependencies: {
          next: "^14.2.0",
          react: "^18.3.0",
          "react-dom": "^18.3.0",
          "framer-motion": "^11.0.0",
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          "@types/react": "^18.3.0",
          "@types/react-dom": "^18.3.0",
          autoprefixer: "^10.4.0",
          postcss: "^8.4.0",
          tailwindcss: "^3.4.0",
          typescript: "^5.7.0",
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
    JSON.stringify({ businessName: ctx.businessName, pages: reactPages }, null, 2),
    "utf8"
  );

  return { projectPath, outPath: path.join(projectPath, "out") };
}

export async function buildReactProject(projectPath: string): Promise<string> {
  const { execSync } = await import("child_process");
  try {
    execSync("npm install", { cwd: projectPath, stdio: "pipe" });
    execSync("npm run build", { cwd: projectPath, stdio: "pipe" });
  } catch (err) {
    const detail =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: Buffer }).stderr ?? "")
        : "";
    throw new Error(detail || (err instanceof Error ? err.message : String(err)));
  }
  return path.join(projectPath, "out");
}
