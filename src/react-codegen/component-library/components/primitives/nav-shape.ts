/**
 * Nav shape is a design decision made by the LLM (nav-surface-agent), not a hardcoded
 * rotation. This module only turns that decision into layout classes — it never picks
 * the shape itself.
 */
export type NavShape = "full-width" | "floating-capsule" | "floating-panel" | "split-inline";

const NAV_SHAPES: readonly NavShape[] = [
  "full-width",
  "floating-capsule",
  "floating-panel",
  "split-inline",
];

export function isNavShape(value: unknown): value is NavShape {
  return typeof value === "string" && (NAV_SHAPES as readonly string[]).includes(value);
}

export interface NavShapeStyle {
  /** Classes on the outer sticky <header> — spacing/inset for floating shapes. */
  headerClass: string;
  /** Classes on the row that lays out logo / links / toggle inside the surface. */
  railClass: string;
  /** Classes on the surface(s) that carry the nav-treatment background. */
  surfaceClass: string;
  /** True when logo and links render as two independent floating surfaces. */
  split: boolean;
}

export function navShapeStyle(shape: NavShape | undefined): NavShapeStyle {
  switch (shape) {
    case "floating-capsule":
      return {
        headerClass: "px-3 pt-3 sm:px-5 sm:pt-5",
        railClass: "flex items-center justify-between",
        surfaceClass: "nav-surface mx-auto w-full max-w-5xl rounded-full px-5 py-2.5 shadow-[var(--shadow)]",
        split: false,
      };
    case "floating-panel":
      return {
        headerClass: "px-3 pt-3 sm:px-5 sm:pt-5",
        railClass: "flex items-center justify-between",
        surfaceClass: "nav-surface mx-auto w-full max-w-6xl rounded-[var(--radius-lg)] px-6 py-3.5 shadow-[var(--shadow)]",
        split: false,
      };
    case "split-inline":
      return {
        headerClass: "px-3 pt-3 sm:px-5 sm:pt-5",
        railClass: "mx-auto flex w-full max-w-6xl items-center justify-between gap-3",
        surfaceClass: "nav-surface rounded-full px-5 py-2.5 shadow-[var(--shadow)]",
        split: true,
      };
    case "full-width":
    default:
      return {
        headerClass: "",
        railClass: "content-rail flex items-center justify-between py-4",
        surfaceClass: "nav-surface w-full border-b border-border/60",
        split: false,
      };
  }
}
