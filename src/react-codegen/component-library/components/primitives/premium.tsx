"use client";

import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export function CursorSpotlight({
  children,
  className = "",
  intensity = 0.35,
}: {
  children: ReactNode;
  className?: string;
  intensity?: number;
}) {
  const reduce = useReducedMotion();
  const [isTouch, setIsTouch] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 120, damping: 22 });
  const sy = useSpring(my, { stiffness: 120, damping: 22 });

  useEffect(() => {
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const background = useTransform([sx, sy], ([x, y]) => {
    const px = (x as number) * 100;
    const py = (y as number) * 100;
    return `radial-gradient(600px circle at ${px}% ${py}%, color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 100)}%, transparent), transparent 55%)`;
  });

  if (reduce || isTouch) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        mx.set((e.clientX - rect.left) / rect.width);
        my.set((e.clientY - rect.top) / rect.height);
      }}
    >
      <motion.div className="pointer-events-none absolute inset-0 z-0" style={{ background }} aria-hidden />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function GlassPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}

export function NoiseGradientBg({
  children,
  className = "",
  strong = false,
}: {
  children?: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className={`absolute inset-0 mesh-gradient ${strong ? "opacity-100" : "opacity-70"}`} aria-hidden />
      <div className="grain-overlay absolute inset-0" aria-hidden />
      {children ? <div className="relative z-10">{children}</div> : null}
    </div>
  );
}

export function TextScrub({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.9", "start 0.3"] });
  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0.25, 1, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [24, 0]);

  if (reduce) {
    return <p className={className}>{text}</p>;
  }

  return (
    <motion.p ref={ref} className={className} style={{ opacity, y }}>
      {text}
    </motion.p>
  );
}

export function ScrollPinSection({
  children,
  media,
  className = "",
  minHeight = "min-h-[120vh]",
}: {
  children: ReactNode;
  media?: ReactNode;
  className?: string;
  minHeight?: string;
}) {
  return (
    <div className={`relative ${minHeight} ${className}`}>
      <div className="sticky top-0 flex min-h-screen items-center">
        <div className="grid w-full items-center gap-10 lg:grid-cols-2">
          <div className="py-section">{children}</div>
          {media ? <div className="relative">{media}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function HorizontalScrollTrack({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      style={{ scrollPaddingInline: "1.5rem" } as CSSProperties}
    >
      {children}
    </div>
  );
}
