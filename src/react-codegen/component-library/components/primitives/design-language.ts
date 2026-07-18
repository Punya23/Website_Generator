export type BandFill = "plain" | "subtle" | "gradient" | "mesh" | "accent";
export type Surface = "none" | "subtle" | "elevated" | "bordered";
export type Panel = "flat" | "bordered" | "elevated" | "glass";
export type Divider = "none" | "line" | "fade" | "angle";
export type MediaOverlay = "none" | "scrim-bottom" | "scrim-full";

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

export function mediaOverlayClass(
  overlay: MediaOverlay | undefined,
  fallback: MediaOverlay = "none"
): string {
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
