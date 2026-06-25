import type { ReactPage, SiteContext } from "../types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHeroEditorial(p: Record<string, unknown>): string {
  const headline = typeof p.headline === "string" ? escapeHtml(p.headline) : "";
  const subcopy = typeof p.subcopy === "string" ? escapeHtml(p.subcopy) : "";
  const img =
    p.image && typeof p.image === "object" && (p.image as { src?: string }).src
      ? (p.image as { src: string }).src
      : "";
  const cta =
    p.cta && typeof p.cta === "object"
      ? (p.cta as { label?: string; href?: string })
      : undefined;

  return `<section class="hero-editorial">
  ${img ? `<img src="${escapeHtml(img)}" alt="" class="hero-bg" />` : ""}
  <div class="hero-overlay"></div>
  <div class="hero-content">
    ${headline ? `<h1>${headline}</h1>` : ""}
    ${subcopy ? `<p class="subcopy">${subcopy}</p>` : ""}
    ${cta?.label ? `<a class="btn" href="${escapeHtml(cta.href ?? "/contact")}">${escapeHtml(cta.label)}</a>` : ""}
  </div>
</section>`;
}

function renderSection(section: ReactPage["sections"][number]): string {
  const p = section.props;

  if (section.templateId === "hero_editorial" || section.templateId === "hero_split_cinematic") {
    return renderHeroEditorial(p);
  }

  const headline = typeof p.headline === "string" ? escapeHtml(p.headline) : "";
  const body =
    typeof p.body === "string"
      ? escapeHtml(p.body)
      : Array.isArray(p.paragraphs)
        ? (p.paragraphs as string[]).map((para) => `<p>${escapeHtml(para)}</p>`).join("")
        : "";
  const img =
    p.image && typeof p.image === "object" && (p.image as { src?: string }).src
      ? `<img src="${escapeHtml((p.image as { src: string }).src)}" alt="" class="section-img" />`
      : "";

  if (section.templateId === "cta_band") {
    const cta =
      p.cta && typeof p.cta === "object"
        ? (p.cta as { label?: string; href?: string })
        : undefined;
    return `<section class="cta-band">
  ${headline ? `<h2>${headline}</h2>` : ""}
  ${cta?.label ? `<a class="btn btn-light" href="${escapeHtml(cta.href ?? "/contact")}">${escapeHtml(cta.label)}</a>` : ""}
</section>`;
  }

  return `<section class="section-block" data-template="${escapeHtml(section.templateId)}">
  ${headline ? `<h2>${headline}</h2>` : ""}
  ${img}
  ${body}
</section>`;
}

export function renderReactPreviewFallback(
  ctx: SiteContext,
  reactPages: Record<string, ReactPage>
): Record<string, string> {
  const c = ctx.designSystem.colors;
  const fonts = ctx.designSystem;
  const nav = Object.values(reactPages)
    .map((p) => {
      const href = p.slug === "home" ? "index.html" : `${p.slug}.html`;
      return `<a href="${href}">${escapeHtml(p.navLabel ?? p.title)}</a>`;
    })
    .join("");

  const shell = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fonts.fontHeading)}:wght@500;600;700&family=${encodeURIComponent(fonts.fontBody)}:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: ${c.bg};
      --text: ${c.text};
      --muted: ${c.muted};
      --accent: ${c.accent};
      --nav-bg: ${c.navBg};
    }
    * { box-sizing: border-box; }
    body { margin:0; font-family: '${fonts.fontBody}', system-ui, sans-serif; background:var(--bg); color:var(--text); }
    .site-nav { display:flex; gap:1.25rem; align-items:center; padding:1rem 1.5rem; background:var(--nav-bg); border-bottom:1px solid rgba(0,0,0,.08); position:sticky; top:0; z-index:10; }
    .site-nav a { color:var(--text); text-decoration:none; font-size:.9rem; opacity:.75; }
    .site-nav a:hover { opacity:1; color:var(--accent); }
    .brand { font-family:'${fonts.fontHeading}', Georgia, serif; font-weight:700; margin-right:auto; opacity:1 !important; }
    .hero-editorial { position:relative; min-height:70vh; display:flex; align-items:flex-end; overflow:hidden; }
    .hero-bg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .hero-overlay { position:absolute; inset:0; background:linear-gradient(to top, rgba(0,0,0,.75), rgba(0,0,0,.2)); }
    .hero-content { position:relative; z-index:1; padding:4rem 1.5rem; max-width:1200px; margin:0 auto; color:#fff; }
    .hero-content h1 { font-family:'${fonts.fontHeading}', Georgia, serif; font-size:clamp(2.25rem,5vw,3.75rem); margin:0 0 1rem; line-height:1.05; }
    .subcopy { font-size:1.125rem; opacity:.9; max-width:40ch; }
    .section-block { padding:4rem 1.5rem; max-width:1200px; margin:0 auto; }
    .section-block h2 { font-family:'${fonts.fontHeading}', Georgia, serif; font-size:clamp(1.75rem,4vw,2.5rem); margin:0 0 1.25rem; }
    .section-block p { color:var(--muted); line-height:1.75; max-width:65ch; }
    .section-img { width:100%; max-height:480px; object-fit:cover; border-radius:4px; margin:1.5rem 0; }
    .cta-band { padding:4rem 1.5rem; text-align:center; background:linear-gradient(135deg, ${c.gradientFrom ?? c.accent}, ${c.gradientTo ?? c.accent}); color:#fff; }
    .cta-band h2 { font-family:'${fonts.fontHeading}', Georgia, serif; font-size:clamp(1.75rem,4vw,2.5rem); margin:0 0 1.5rem; }
    .btn { display:inline-block; padding:.75rem 1.5rem; background:var(--accent); color:#fff; text-decoration:none; border-radius:999px; font-weight:600; }
    .btn-light { background:#fff; color:var(--accent); }
    footer { padding:2rem; text-align:center; color:var(--muted); font-size:.875rem; border-top:1px solid rgba(0,0,0,.08); }
  </style>
</head>
<body>
  <nav class="site-nav">
    <span class="brand">${escapeHtml(ctx.businessName)}</span>
    ${nav}
  </nav>
  <main>${body}</main>
  <footer>© ${new Date().getFullYear()} ${escapeHtml(ctx.businessName)} · ${escapeHtml(ctx.designSystem.mood)}</footer>
</body>
</html>`;

  const out: Record<string, string> = {};
  for (const page of Object.values(reactPages)) {
    const html = shell(
      `${page.title} · ${ctx.businessName}`,
      page.sections.map(renderSection).join("\n")
    );
    out[page.slug] = html;
  }
  return out;
}
