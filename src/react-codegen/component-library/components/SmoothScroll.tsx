"use client";

import { useEffect, type ReactNode } from "react";

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let frame = 0;

    import("lenis")
      .then(({ default: Lenis }) => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        lenis = new Lenis({ duration: 1.05, smoothWheel: true });
        const loop = (time: number) => {
          lenis?.raf(time);
          frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
      })
      .catch(() => undefined);

    return () => {
      cancelAnimationFrame(frame);
      lenis?.destroy();
    };
  }, []);

  return <>{children}</>;
}
