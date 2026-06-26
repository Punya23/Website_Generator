"use client";

import { useEffect, useState } from "react";

export function StickyMobileCta({ label, href }: { label: string; href: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-bg/95 p-3 backdrop-blur-md md:hidden">
      <a
        href={href}
        className="flex w-full items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg"
      >
        {label}
      </a>
    </div>
  );
}
