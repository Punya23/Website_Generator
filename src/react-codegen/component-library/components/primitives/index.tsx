"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionPreset, useRevealVariants, useStaggerDelay, useSectionMotion } from "../MotionProvider";
import { useCurrentSectionId } from "../SectionContext";

export function Reveal({
  children,
  className = "",
  delay = 0,
  sectionId: sectionIdProp,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  sectionId?: string;
}) {
  const reduce = useReducedMotion();
  const sectionId = sectionIdProp ?? useCurrentSectionId();
  const variants = useRevealVariants(sectionId);
  const sectionMotion = useSectionMotion(sectionId);
  if (sectionMotion?.entrance === "none") {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={variants}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className = "",
  sectionId: sectionIdProp,
}: {
  children: ReactNode;
  className?: string;
  sectionId?: string;
}) {
  const reduce = useReducedMotion();
  const sectionId = sectionIdProp ?? useCurrentSectionId();
  const stagger = useStaggerDelay(sectionId);
  const sectionMotion = useSectionMotion(sectionId);
  if (sectionMotion?.entrance === "none") {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className = "",
  sectionId: sectionIdProp,
}: {
  children: ReactNode;
  className?: string;
  sectionId?: string;
}) {
  const reduce = useReducedMotion();
  const sectionId = sectionIdProp ?? useCurrentSectionId();
  const variants = useRevealVariants(sectionId);
  return (
    <motion.div
      className={className}
      variants={reduce ? undefined : variants}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-content px-6 md:px-10 ${className}`}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-muted">{children}</p>
  );
}

export function MonoTag({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[0.7rem] uppercase tracking-widest text-muted">({children})</span>
  );
}

export function DisplayHeading({ children, as: Tag = "h2", className = "" }: { children: ReactNode; as?: "h1" | "h2" | "h3"; className?: string }) {
  return (
    <Tag className={`font-display text-display leading-[1.05] tracking-tight text-text ${className}`}>
      {children}
    </Tag>
  );
}

export function PrimaryButton({ href, children }: { href?: string; children: ReactNode }) {
  const cls =
    "magnetic-btn inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90";
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls}>
      {children}
    </button>
  );
}

export function MagneticButton({
  href,
  children,
  className = "",
}: {
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const cls = `magnetic-btn inline-flex items-center justify-center rounded-full transition ${className}`;
  if (href) {
    return (
      <motion.a
        href={href}
        className={cls}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        {children}
      </motion.a>
    );
  }
  return (
    <motion.button
      type="button"
      className={cls}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </motion.button>
  );
}

export function SplitRevealHeading({
  text,
  as: Tag = "h1",
  className = "",
}: {
  text: string;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const lines = text.split(/\n|(?<=\.)\s+/).filter(Boolean);
  const reduce = useReducedMotion();
  if (reduce || lines.length <= 1) {
    return <DisplayHeading as={Tag} className={className}>{text}</DisplayHeading>;
  }
  return (
    <Tag className={`font-display text-display leading-[1.05] tracking-tight text-text ${className}`}>
      {lines.map((line, i) => (
        <motion.span
          key={i}
          className="block overflow-hidden"
          initial={{ opacity: 0, y: "100%" }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
        >
          {line}
        </motion.span>
      ))}
    </Tag>
  );
}

export function SectionDivider({ variant = "angle" }: { variant?: "angle" | "fade" }) {
  if (variant === "fade") {
    return <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" aria-hidden />;
  }
  return <div className="section-divider-angle h-16 w-full bg-surface mesh-gradient" aria-hidden />;
}

export {
  CursorSpotlight,
  GlassPanel,
  HorizontalScrollTrack,
  NoiseGradientBg,
  ScrollPinSection,
  TextScrub,
} from "./premium";
