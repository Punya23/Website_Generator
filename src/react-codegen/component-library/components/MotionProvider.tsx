"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useReducedMotion, type Variants } from "framer-motion";

export type MotionPresetName =
  | "fade-up"
  | "stagger"
  | "scale-in"
  | "slide-left"
  | "parallax-hero"
  | "none";

export type SectionEntrance = "reveal" | "stagger" | "scale-in" | "slide-left" | "none";

export interface SectionMotionConfig {
  entrance: SectionEntrance;
  staggerDelay?: number;
  parallax?: boolean;
  marquee?: boolean;
  presetOverride?: MotionPresetName;
}

export interface SiteMotionPlanData {
  globalPreset: MotionPresetName;
  reducedMotion: "respect" | "minimal";
  navScrollEnhance: boolean;
  sections: Record<string, SectionMotionConfig>;
  chrome: {
    footer: SectionMotionConfig;
    nav: { compactOnScroll: boolean; shadowOnScroll?: boolean };
  };
}

const MOTION_PRESETS: MotionPresetName[] = [
  "fade-up",
  "stagger",
  "scale-in",
  "slide-left",
  "parallax-hero",
  "none",
];

const SECTION_ENTRANCES: SectionEntrance[] = ["reveal", "stagger", "scale-in", "slide-left", "none"];

function coercePreset(value: unknown, fallback: MotionPresetName = "fade-up"): MotionPresetName {
  if (typeof value === "string" && MOTION_PRESETS.includes(value as MotionPresetName)) {
    return value as MotionPresetName;
  }
  return fallback;
}

function coerceEntrance(value: unknown): SectionEntrance {
  if (typeof value === "string" && SECTION_ENTRANCES.includes(value as SectionEntrance)) {
    return value as SectionEntrance;
  }
  return "reveal";
}

function coerceOptionalPreset(value: unknown): MotionPresetName | undefined {
  if (typeof value === "string" && MOTION_PRESETS.includes(value as MotionPresetName)) {
    return value as MotionPresetName;
  }
  return undefined;
}

function coerceSectionMotion(raw: unknown): SectionMotionConfig {
  const cfg = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    entrance: coerceEntrance(cfg.entrance),
    staggerDelay: typeof cfg.staggerDelay === "number" ? cfg.staggerDelay : undefined,
    parallax: cfg.parallax === true,
    marquee: cfg.marquee === true,
    presetOverride: coerceOptionalPreset(cfg.presetOverride),
  };
}

/** Coerce JSON motion plan from codegen into a typed plan (safe for Next.js layout). */
export function coerceMotionPlan(raw: unknown): SiteMotionPlanData | null {
  if (!raw || typeof raw !== "object") return null;
  const plan = raw as Record<string, unknown>;
  const sectionsRaw =
    plan.sections && typeof plan.sections === "object"
      ? (plan.sections as Record<string, unknown>)
      : {};
  const chromeRaw =
    plan.chrome && typeof plan.chrome === "object"
      ? (plan.chrome as Record<string, unknown>)
      : {};

  return {
    globalPreset: coercePreset(plan.globalPreset, "stagger"),
    reducedMotion: plan.reducedMotion === "minimal" ? "minimal" : "respect",
    navScrollEnhance: plan.navScrollEnhance !== false,
    sections: Object.fromEntries(
      Object.entries(sectionsRaw).map(([id, cfg]) => [id, coerceSectionMotion(cfg)])
    ),
    chrome: {
      footer: coerceSectionMotion(chromeRaw.footer),
      nav: (() => {
        const nav =
          chromeRaw.nav && typeof chromeRaw.nav === "object"
            ? (chromeRaw.nav as Record<string, unknown>)
            : null;
        return {
          compactOnScroll: nav?.compactOnScroll !== false,
          shadowOnScroll: nav?.shadowOnScroll !== false,
        };
      })(),
    },
  };
}

interface MotionContextValue {
  preset: MotionPresetName;
  plan: SiteMotionPlanData | null;
}

const MotionContext = createContext<MotionContextValue>({ preset: "fade-up", plan: null });

export function MotionProvider({
  preset,
  plan,
  children,
}: {
  preset?: string;
  /** Accepts raw JSON from generated layout.tsx — coerced internally. */
  plan?: SiteMotionPlanData | Record<string, unknown> | null;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    const normalized = plan && typeof plan === "object" && "globalPreset" in plan
      ? coerceMotionPlan(plan)
      : (plan as SiteMotionPlanData | null);
    return {
      preset: coercePreset(preset ?? normalized?.globalPreset, "fade-up"),
      plan: normalized,
    };
  }, [preset, plan]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotionPreset(): MotionPresetName {
  return useContext(MotionContext).preset;
}

export function useMotionPlan(): SiteMotionPlanData | null {
  return useContext(MotionContext).plan;
}

export function useSectionMotion(sectionId?: string): SectionMotionConfig | null {
  const plan = useMotionPlan();
  if (!sectionId || !plan) return null;
  return plan.sections[sectionId] ?? null;
}

export function useChromeFooterMotion(): SectionMotionConfig | null {
  const plan = useMotionPlan();
  return plan?.chrome?.footer ?? null;
}

export function useChromeNavSpec(): SiteMotionPlanData["chrome"]["nav"] | null {
  const plan = useMotionPlan();
  return plan?.chrome?.nav ?? null;
}

function entranceToPreset(entrance: SectionEntrance): MotionPresetName {
  switch (entrance) {
    case "scale-in":
      return "scale-in";
    case "slide-left":
      return "slide-left";
    case "stagger":
      return "stagger";
    case "none":
      return "none";
    default:
      return "fade-up";
  }
}

export function useRevealVariants(sectionId?: string): Variants {
  const { preset } = useContext(MotionContext);
  const sectionMotion = useSectionMotion(sectionId);
  const plan = useMotionPlan();
  const prefersReduced = useReducedMotion();
  const effective =
    sectionMotion?.presetOverride ??
    (sectionMotion ? entranceToPreset(sectionMotion.entrance) : preset);

  return useMemo(() => {
    if (prefersReduced || plan?.reducedMotion === "respect") {
      return {
        hidden: { opacity: 1, y: 0, scale: 1, x: 0 },
        visible: { opacity: 1, y: 0, scale: 1, x: 0 },
      };
    }

    switch (effective) {
      case "scale-in":
        return {
          hidden: { opacity: 0, scale: 0.96 },
          visible: { opacity: 1, scale: 1 },
        };
      case "slide-left":
        return {
          hidden: { opacity: 0, x: 32 },
          visible: { opacity: 1, x: 0 },
        };
      case "none":
        return {
          hidden: { opacity: 1 },
          visible: { opacity: 1 },
        };
      case "parallax-hero":
        return {
          hidden: { opacity: 0, y: 60, scale: 1.03 },
          visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } },
        };
      case "stagger":
        return {
          hidden: { opacity: 0, y: 32 },
          visible: { opacity: 1, y: 0 },
        };
      case "fade-up":
      default:
        return {
          hidden: { opacity: 0, y: 40 },
          visible: { opacity: 1, y: 0 },
        };
    }
  }, [effective, prefersReduced, plan?.reducedMotion]);
}

export function useStaggerDelay(sectionId?: string): number {
  const { preset } = useContext(MotionContext);
  const sectionMotion = useSectionMotion(sectionId);
  if (sectionMotion?.staggerDelay != null) return sectionMotion.staggerDelay;
  if (sectionMotion?.entrance === "stagger") return 0.08;
  if (preset === "stagger") return 0.08;
  if (preset === "scale-in") return 0.07;
  return 0.06;
}

export function useSectionParallax(sectionId?: string): boolean {
  const sectionMotion = useSectionMotion(sectionId);
  return sectionMotion?.parallax ?? false;
}
