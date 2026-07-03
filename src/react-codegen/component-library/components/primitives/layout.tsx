import type { ReactNode } from "react";

/** Two-column hero: stacks on mobile, side-by-side from md+. Layout is fixed — LLM cannot break it. */
export function SplitHeroLayout({
  copy,
  media,
  mediaRight = true,
  className = "",
}: {
  copy: ReactNode;
  media: ReactNode;
  mediaRight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`split-hero grid w-full min-w-0 items-center gap-8 md:grid-cols-2 md:gap-10 lg:gap-12 ${
        mediaRight ? "" : "md:[&>*:first-child]:order-2"
      } ${className}`}
    >
      <div className="min-w-0">{copy}</div>
      <div className="min-w-0">{media}</div>
    </div>
  );
}

/** Responsive card grid — 1 → 2 → 3 columns. Prevents cramped multi-col on tablet. */
export function CardGrid({
  children,
  columns = 3,
  className = "",
  id,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
  id?: string;
}) {
  const colClass =
    columns === 4
      ? "card-grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      : columns === 2
        ? "card-grid sm:grid-cols-2"
        : "card-grid sm:grid-cols-2 lg:grid-cols-3";
  return <div id={id} className={`${colClass} ${className}`}>{children}</div>;
}

/** Responsive bento grid — 1 → 2 → 3 → 4 cols with safe row heights. */
export function BentoGrid({
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
      className={`card-grid auto-rows-[minmax(180px,auto)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${className}`}
    >
      {children}
    </div>
  );
}

/** Section shell inner wrapper — always full width inside content rail. */
export function SectionBody({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return <div id={id} className={`w-full ${className}`}>{children}</div>;
}

/** Inner content width cap — use inside Container, never on Container itself. */
export function ContentMeasure({
  children,
  size = "md",
  className = "",
  id,
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "full";
  className?: string;
  id?: string;
}) {
  const sizeClass =
    size === "sm"
      ? "content-narrow-sm"
      : size === "lg"
        ? "content-narrow-lg"
        : size === "full"
          ? "w-full"
          : "content-narrow";
  return <div id={id} className={`${sizeClass} ${className}`}>{children}</div>;
}

