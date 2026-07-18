"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useChromeNavSpec } from "./MotionProvider";
import { navShapeStyle, type NavShape } from "./primitives/nav-shape";

const MotionLink = motion(Link);

export function SiteNav({
  businessName,
  links,
  navShape,
}: {
  businessName: string;
  links: Array<{ slug: string; label: string }>;
  navShape?: NavShape;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navSpec = useChromeNavSpec();
  const style = navShapeStyle(navShape);

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

  const toggleButton = (
    <button
      type="button"
      className="relative z-[60] md:hidden text-nav-text"
      onClick={() => setOpen((v) => !v)}
      aria-label="Toggle menu"
      aria-expanded={open}
    >
      {open ? "✕" : "☰"}
    </button>
  );

  const desktopNav = (
    <nav className="hidden md:flex md:flex-row md:gap-1">
      {links.map((link) => (
        <NavLink key={link.slug} link={link} active={link.slug === activeSlug} onNavigate={() => setOpen(false)} />
      ))}
    </nav>
  );

  const logo = (
    <Link href="/" className="font-display text-lg font-bold text-nav-text">
      {businessName}
    </Link>
  );

  return (
    <header
      className={`site-nav sticky top-0 z-50 ${style.headerClass} ${
        showScrolled ? "is-scrolled" : ""
      } ${navSpec?.compactOnScroll && scrolled ? "nav-compact" : ""}`}
    >
      {style.split ? (
        <div className={style.railClass}>
          <div className={`${style.surfaceClass} flex items-center`}>{logo}</div>
          <div className={`${style.surfaceClass} flex items-center gap-1`}>
            {toggleButton}
            {desktopNav}
          </div>
        </div>
      ) : (
        <div className={style.surfaceClass}>
          <div className={style.railClass}>
            {logo}
            {toggleButton}
            {desktopNav}
          </div>
        </div>
      )}

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
  const isMobileLink = className.includes("text-3xl");
  return (
    <MotionLink
      href={href}
      onClick={onNavigate}
      whileHover={isMobileLink ? undefined : { scale: 1.06 }}
      whileTap={isMobileLink ? undefined : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
      className={`rounded-[var(--radius)] px-3 py-1.5 text-sm transition ${className} ${
        active && !isMobileLink
          ? "bg-nav-active text-nav-active-text shadow-sm"
          : active
            ? "text-accent"
            : "text-nav-muted hover:text-nav-text"
      }`}
    >
      {link.label}
    </MotionLink>
  );
}
