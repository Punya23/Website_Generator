"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function SiteNav({
  businessName,
  links,
}: {
  businessName: string;
  links: Array<{ slug: string; label: string }>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const activeSlug =
    pathname === "/" ? "home" : pathname.replace(/^\//, "").split("/")[0] ?? "home";

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-nav/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10">
        <Link href="/" className="font-display text-lg font-bold text-nav-text">
          {businessName}
        </Link>
        <button
          type="button"
          className="md:hidden text-nav-text"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          ☰
        </button>
        <nav className={`${open ? "flex" : "hidden"} absolute left-0 right-0 top-full flex-col gap-1 border-b border-border bg-nav p-4 md:static md:flex md:flex-row md:border-0 md:bg-transparent md:p-0`}>
          {links.map((link) => {
            const href = link.slug === "home" ? "/" : `/${link.slug}`;
            const active = link.slug === activeSlug;
            return (
              <Link
                key={link.slug}
                href={href}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  active ? "bg-nav-active text-nav-active-text" : "text-nav-muted hover:text-nav-text"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
