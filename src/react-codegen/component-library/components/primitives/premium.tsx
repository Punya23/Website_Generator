"use client";

import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export function CursorSpotlight({
  children,
  className = "",
  intensity = 0.35,
  id,
}: {
  children: ReactNode;
  className?: string;
  intensity?: number;
  id?: string;
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
    return <div id={id} className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      id={id}
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
  id,
  variant = "glass",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  variant?: "glass" | "solid";
}) {
  const surface =
    variant === "solid"
      ? "rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-[var(--shadow)]"
      : "rounded-[var(--radius-lg)] border border-white/10 bg-white/5 p-6 shadow-[var(--shadow)] backdrop-blur-md";
  return (
    <div id={id} className={`${surface} ${className}`}>
      {children}
    </div>
  );
}

export function NoiseGradientBg({
  children,
  className = "",
  strong = false,
  mesh = true,
  grain = true,
  id,
}: {
  children?: ReactNode;
  className?: string;
  strong?: boolean;
  mesh?: boolean;
  grain?: boolean;
  id?: string;
}) {
  return (
    <div id={id} className={`relative overflow-hidden ${className}`}>
      {mesh ? (
        <div className={`absolute inset-0 mesh-gradient ${strong ? "opacity-100" : "opacity-70"}`} aria-hidden />
      ) : null}
      {grain ? <div className="grain-overlay absolute inset-0" aria-hidden /> : null}
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
  id,
}: {
  children: ReactNode;
  media?: ReactNode;
  className?: string;
  minHeight?: string;
  id?: string;
}) {
  return (
    <div id={id} className={`relative ${minHeight} ${className}`}>
      <div className="sticky top-0 flex min-h-screen items-center">
        <div className="grid w-full min-w-0 items-center gap-8 md:grid-cols-2 md:gap-10">
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
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      style={{ scrollPaddingInline: "var(--content-padding)" } as CSSProperties}
    >
      {children}
    </div>
  );
}
