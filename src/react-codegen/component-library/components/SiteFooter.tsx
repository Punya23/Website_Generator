"use client";

import Link from "next/link";
import { Reveal, Stagger, StaggerItem } from "./primitives";
import { useChromeFooterMotion } from "./MotionProvider";

type FooterLayout = "two-column" | "centered" | "cta-heavy";

type LinkGroup = { label: string; slugs: Array<{ slug: string; label: string }> };

export function SiteFooter({
  businessName,
  mood,
  tagline,
  ctaLabel,
  ctaHref,
  links,
  layout = "two-column",
  linkGroups,
  showMood = true,
  newsletter,
}: {
  businessName: string;
  mood: string;
  tagline?: string;
  ctaLabel?: string;
  ctaHref?: string;
  links: Array<{ slug: string; label: string }>;
  layout?: FooterLayout;
  linkGroups?: LinkGroup[];
  showMood?: boolean;
  newsletter?: {
    headline: string;
    subcopy?: string;
    placeholder?: string;
    buttonLabel?: string;
  };
}) {
  const footerMotion = useChromeFooterMotion();
  const entrance = footerMotion?.entrance ?? "stagger";
  const useStagger = entrance === "stagger";

  const resolvedGroups: LinkGroup[] =
    linkGroups ??
    (layout === "two-column"
      ? [{ label: "Pages", slugs: links }]
      : []);

  const gridClass =
    layout === "centered"
      ? "text-center"
      : layout === "cta-heavy"
        ? "md:grid-cols-1 md:text-center"
        : "md:grid-cols-[1.2fr_1fr] md:items-end";

  const linkGrid = (
    <div className={`grid gap-10 ${gridClass}`}>
      <div>
        <p className="font-display text-2xl font-bold text-text">{businessName}</p>
        {tagline ? <p className="mt-2 max-w-md text-muted">{tagline}</p> : null}
        {showMood ? (
          <p className="mt-4 text-xs uppercase tracking-widest text-muted">{mood}</p>
        ) : null}
      </div>
      {layout !== "cta-heavy" && resolvedGroups.length > 0 ? (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          {resolvedGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                {group.label}
              </p>
              {useStagger ? (
                <Stagger>
                  {group.slugs.map((link) => (
                    <StaggerItem key={link.slug}>
                      <FooterLink link={link} />
                    </StaggerItem>
                  ))}
                </Stagger>
              ) : (
                group.slugs.map((link) => <FooterLink key={link.slug} link={link} />)
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <footer className="site-footer border-t border-border bg-surface/50">
      {newsletter ? (
        <div className="border-b border-border bg-surface/80 py-12">
          <div className="mx-auto max-w-content px-6 text-center md:px-10">
            <p className="font-display text-xl font-semibold text-text">{newsletter.headline}</p>
            {newsletter.subcopy ? <p className="mt-2 text-sm text-muted">{newsletter.subcopy}</p> : null}
            <form className="mx-auto mt-6 flex max-w-md flex-col gap-2 sm:flex-row" onSubmit={(e) => e.preventDefault()}>
              <input
                type="email"
                placeholder={newsletter.placeholder ?? "you@example.com"}
                className="flex-1 rounded-full border border-border bg-bg px-4 py-2.5 text-sm outline-none focus:border-accent"
                aria-label="Email"
              />
              <button
                type="submit"
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white"
              >
                {newsletter.buttonLabel ?? "Subscribe"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
      <div className="mx-auto max-w-content px-6 py-16 md:px-10">
        <Reveal>
          {useStagger ? <Stagger>{linkGrid}</Stagger> : linkGrid}
          {ctaLabel ? (
            <div className={`mt-10 ${layout === "centered" || layout === "cta-heavy" ? "text-center" : ""}`}>
              <a
                href={ctaHref ?? "/contact"}
                className="inline-flex rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                {ctaLabel}
              </a>
            </div>
          ) : null}
          <p className={`mt-12 text-xs text-muted ${layout === "centered" ? "text-center" : "md:text-left text-center"}`}>
            © {new Date().getFullYear()} {businessName}
          </p>
        </Reveal>
      </div>
    </footer>
  );
}

function FooterLink({ link }: { link: { slug: string; label: string } }) {
  return (
    <Link
      href={link.slug === "home" ? "/" : `/${link.slug}`}
      className="block py-1 text-sm text-muted transition hover:text-accent"
    >
      {link.label}
    </Link>
  );
}
