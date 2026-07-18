"use client";

import { useEffect, useState } from "react";
import { panelClass, type Panel } from "./primitives";

export function StickyMobileCta({
  label,
  href,
  panel,
}: {
  label: string;
  href: string;
  panel?: Panel;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 md:hidden ${panelClass(panel)}`}>
      <a
        href={href}
        className="flex w-full items-center justify-center rounded-[var(--radius)] bg-accent px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow)]"
      >
        {label}
      </a>
    </div>
  );
}
