/**
 * Typed design-language contract — closed enums the LLM chooses (examples in prompts),
 * then resolvers that turn those choices into CSS class strings. Components never invent
 * ad-hoc treatment classNames.
 */
import { z } from "zod";
import type { AccentRole, SiteTheme } from "../types.js";
import type { SiteFxTreatment } from "./site-fx.js";

export const BandFillSchema = z.enum(["plain", "subtle", "gradient", "mesh", "accent"]);
export const SurfaceSchema = z.enum(["none", "subtle", "elevated", "bordered"]);
export const PanelSchema = z.enum(["flat", "bordered", "elevated", "glass"]);
export const DividerSchema = z.enum(["none", "line", "fade", "angle"]);
export const MediaOverlaySchema = z.enum(["none", "scrim-bottom", "scrim-full"]);

export type BandFill = z.infer<typeof BandFillSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type Panel = z.infer<typeof PanelSchema>;
export type Divider = z.infer<typeof DividerSchema>;
export type MediaOverlay = z.infer<typeof MediaOverlaySchema>;

/** Shared optional paint props for section schemas. */
export const designLanguageFields = {
  surface: SurfaceSchema.optional(),
  bandFill: BandFillSchema.optional(),
  panel: PanelSchema.optional(),
  divider: DividerSchema.optional(),
  mediaOverlay: MediaOverlaySchema.optional(),
};

export interface SiteVisualContract {
  visualFx: SiteFxTreatment;
  accentRole: AccentRole;
  defaultSurface: Surface;
  defaultPanel: Panel;
  defaultBandFill: BandFill;
  gradientMood: "subtle" | "vivid" | "monochrome";
}

export function resolveSiteVisualContract(
  theme: SiteTheme,
  visualFx: SiteFxTreatment
): SiteVisualContract {
  const accentRole = theme.accentRole ?? "sparing";
  const defaultSurface: Surface =
    theme.surfaces?.default === "elevated"
      ? "elevated"
      : theme.surfaces?.default === "bordered"
        ? "bordered"
        : theme.surfaces?.default === "none"
          ? "none"
          : accentRole === "editorial"
            ? "subtle"
            : "bordered";
  const defaultPanel: Panel =
    visualFx === "glass" ? "glass" : accentRole === "hero" ? "elevated" : "bordered";
  const defaultBandFill: BandFill =
    visualFx === "spotlight" || visualFx === "glass"
      ? "mesh"
      : accentRole === "hero"
        ? "gradient"
        : "plain";

  return {
    visualFx,
    accentRole,
    defaultSurface,
    defaultPanel,
    defaultBandFill,
    gradientMood: theme.gradientMood ?? "subtle",
  };
}

/** Stamp section props with site defaults only when the LLM left paint fields unset. */
export function applyVisualContractToProps(
  props: Record<string, unknown>,
  contract: SiteVisualContract,
  options?: { forceVisualFx?: boolean }
): Record<string, unknown> {
  const next = { ...props };
  if (options?.forceVisualFx !== false) {
    next.visualFx = next.visualFx ?? contract.visualFx;
  }
  if (next.surface == null) next.surface = contract.defaultSurface;
  if (next.panel == null) next.panel = contract.defaultPanel;
  if (next.bandFill == null) next.bandFill = contract.defaultBandFill;
  return next;
}

const HERO_PREFIX = "hero_";
const CONVERSION_TEMPLATES = new Set(["cta_band", "footer_cta", "newsletter_band"]);
/** Templates that carry their own full-bleed media/scroll experience and read best edge-to-edge. */
const BLEED_TEMPLATES = new Set([
  "gallery_masonry",
  "horizontal_gallery",
  "portfolio_carousel",
  "logo_marquee",
  "text_marquee",
]);

/**
 * Sequence-aware paint pass (research: "alternate section surfaces + one vertical rhythm" is the
 * single biggest fix for the machine-assembled look). The old code stamped ONE surface/bandFill on
 * every section, so every band was identical top-to-bottom → the literal "monotonous rhythm" QA
 * flag. This walks a page's ordered sections and assigns paint by POSITION: neutral surfaces
 * alternate so no two adjacent bands share a background, the accent gradient is reserved for the
 * single conversion closer, and heroes/bleed sections stay plain so their own media carries them.
 * It only fills fields the LLM left unset, so explicit creative choices still win.
 */
export function applyPageRhythm(
  instances: Array<{ templateId: string; props: Record<string, unknown> }>,
  contract: SiteVisualContract
): void {
  // Neutral band alternation: plain ↔ subtle, capped at 2 consecutive of the same fill.
  const neutralCycle: BandFill[] = ["plain", "subtle"];
  let neutralIdx = 0;
  let runFill: BandFill | null = null;
  let runLen = 0;

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i]!;
    const props = inst.props;
    // Always ensure visualFx is stamped (unchanged behavior).
    props.visualFx = props.visualFx ?? contract.visualFx;

    const isHero = inst.templateId.startsWith(HERO_PREFIX);
    const isConversion = CONVERSION_TEMPLATES.has(inst.templateId);
    const isBleed = BLEED_TEMPLATES.has(inst.templateId);

    // Panel default is positional-neutral — keep the contract's choice.
    if (props.panel == null) props.panel = contract.defaultPanel;

    if (props.bandFill == null) {
      let fill: BandFill;
      if (isHero) {
        // Hero: its own media/mesh carries it; keep it plain unless the site uses hero gradients.
        fill = contract.defaultBandFill === "mesh" ? "mesh" : "plain";
      } else if (isConversion) {
        // The one conversion closer earns the accent gradient (60/30/10 accent discipline).
        fill = contract.accentRole === "sparing" ? "subtle" : "gradient";
      } else {
        // Body sections alternate neutral surfaces, capped at a 2-run so it never flatlines.
        let candidate = neutralCycle[neutralIdx % neutralCycle.length]!;
        if (candidate === runFill && runLen >= 2) {
          neutralIdx++;
          candidate = neutralCycle[neutralIdx % neutralCycle.length]!;
        }
        fill = candidate;
        neutralIdx++;
      }
      props.bandFill = fill;
      if (fill === runFill) runLen++;
      else {
        runFill = fill;
        runLen = 1;
      }
    }

    // Surface: give body sections a real surface only when they sit on a plain band, so cards/panels
    // separate from the page; on a subtle band leave them flat to avoid muddy double-fills.
    // (Full-bleed vs contained rhythm is already encoded per-template via SectionShell `mode`.)
    if (props.surface == null) {
      props.surface = isHero || isBleed ? "none" : contract.defaultSurface;
    }
  }
}

export function bandFillClass(fill: BandFill | undefined, fallback: BandFill = "plain"): string {
  switch (fill ?? fallback) {
    case "subtle":
      return "bg-surface/50";
    case "gradient":
      return "cta-gradient text-white";
    case "mesh":
      return "mesh-gradient";
    case "accent":
      return "bg-accent text-nav-active-text";
    case "plain":
    default:
      return "bg-bg";
  }
}

export function surfaceClass(surface: Surface | undefined, fallback: Surface = "none"): string {
  switch (surface ?? fallback) {
    case "subtle":
      return "bg-surface/50";
    case "elevated":
      return "surface-elevated";
    case "bordered":
      return "border border-border bg-surface/60";
    case "none":
    default:
      return "";
  }
}

export function panelClass(panel: Panel | undefined, fallback: Panel = "bordered"): string {
  switch (panel ?? fallback) {
    case "flat":
      return "rounded-[var(--radius-lg)] bg-surface p-6";
    case "elevated":
      return "surface-elevated rounded-[var(--radius-lg)] p-6";
    case "glass":
      return "rounded-[var(--radius-lg)] border border-white/10 bg-white/5 p-6 shadow-[var(--shadow)] backdrop-blur-md";
    case "bordered":
    default:
      return "rounded-[var(--radius-lg)] border border-border bg-surface/80 p-6 shadow-[var(--shadow)]";
  }
}

export function mediaOverlayClass(overlay: MediaOverlay | undefined, fallback: MediaOverlay = "none"): string {
  switch (overlay ?? fallback) {
    case "scrim-bottom":
      return "absolute inset-0 bg-gradient-to-t from-bg/90 via-bg/30 to-transparent";
    case "scrim-full":
      return "absolute inset-0 bg-bg/50";
    case "none":
    default:
      return "";
  }
}

export function dividerClass(divider: Divider | undefined): string {
  switch (divider) {
    case "line":
      return "border-t border-border";
    case "fade":
      return "border-t border-transparent bg-gradient-to-r from-transparent via-border to-transparent";
    case "angle":
      return "section-divider-angle";
    case "none":
    default:
      return "";
  }
}
