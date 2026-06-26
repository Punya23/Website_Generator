"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useChromeNavSpec } from "./MotionProvider";

export function SiteNav({
  businessName,
  links,
}: {
  businessName: string;
  links: Array<{ slug: string; label: string }>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navSpec = useChromeNavSpec();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const showScrolled = scrolled && (navSpec?.shadowOnScroll !== false);

  const activeSlug =
    pathname === "/" ? "home" : pathname.replace(/^\//, "").split("/")[0] ?? "home";

  return (
    <header className={`site-nav sticky top-0 z-50 border-b border-border/60 ${showScrolled ? "is-scrolled" : ""} ${navSpec?.compactOnScroll && scrolled ? "py-2" : ""}`}>
      <div className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10">
        <Link href="/" className="font-display text-lg font-bold text-nav-text">
          {businessName}
        </Link>
        <button
          type="button"
          className="relative z-[60] md:hidden text-nav-text"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? "✕" : "☰"}
        </button>
        <nav className="hidden md:flex md:flex-row md:gap-1">
          {links.map((link) => (
            <NavLink key={link.slug} link={link} active={link.slug === activeSlug} onNavigate={() => setOpen(false)} />
          ))}
        </nav>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[55] flex flex-col bg-nav md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="flex flex-1 flex-col justify-center gap-2 px-10">
              {links.map((link, i) => (
                <motion.div
                  key={link.slug}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ delay: i * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                  <NavLink
                    link={link}
                    active={link.slug === activeSlug}
                    onNavigate={() => setOpen(false)}
                    className="block py-3 font-display text-3xl font-semibold"
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function NavLink({
  link,
  active,
  onNavigate,
  className = "",
}: {
  link: { slug: string; label: string };
  active: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const href = link.slug === "home" ? "/" : `/${link.slug}`;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`rounded-full px-3 py-1.5 text-sm transition ${className} ${
        active && !className.includes("text-3xl")
          ? "bg-nav-active text-nav-active-text"
          : active
            ? "text-accent"
            : "text-nav-muted hover:text-nav-text"
      }`}
    >
      {link.label}
    </Link>
  );
}
