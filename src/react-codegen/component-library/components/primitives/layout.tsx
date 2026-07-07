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

/** Column classes that match item count — avoids 2 tiny cards in a 4-column grid. */
export function cardGridClassForCount(
  count: number,
  options?: { bento?: boolean; maxColumns?: 3 | 4 }
): string {
  const n = Math.max(1, count);
  const maxColumns = options?.maxColumns ?? 4;
  const rowMin = options?.bento ? " auto-rows-[minmax(220px,auto)]" : "";

  if (n === 1) return `card-grid grid-cols-1${rowMin}`;
  if (n === 2) return `card-grid sm:grid-cols-2${rowMin}`;
  if (n === 3) return `card-grid sm:grid-cols-2 lg:grid-cols-3${rowMin}`;
  if (n === 4) {
    return maxColumns >= 4
      ? `card-grid sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4${rowMin}`
      : `card-grid sm:grid-cols-2 lg:grid-cols-2${rowMin}`;
  }
  if (n <= 6) return `card-grid sm:grid-cols-2 lg:grid-cols-3${rowMin}`;
  return `card-grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4${rowMin}`;
}

/** Default bento span when the LLM omits span — adds rhythm without shrinking cards. */
export function defaultBentoSpan(index: number, total: number, explicit?: string): string | undefined {
  if (explicit && explicit !== "normal") return explicit;
  if (total === 2) return undefined;
  if (total === 3 && index === 0) return "large";
  if (total >= 4 && index === 0) return "wide";
  if (total >= 5 && index === 3) return "wide";
  return undefined;
}

/** Responsive card grid — columns follow child count when itemCount is passed. */
export function CardGrid({
  children,
  columns = 3,
  itemCount,
  className = "",
  id,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  itemCount?: number;
  className?: string;
  id?: string;
}) {
  const colClass =
    itemCount !== undefined
      ? cardGridClassForCount(itemCount, { maxColumns: columns === 4 ? 4 : 3 })
      : columns === 4
        ? cardGridClassForCount(4, { maxColumns: 4 })
        : columns === 2
          ? cardGridClassForCount(2)
          : cardGridClassForCount(3);
  return <div id={id} className={`${colClass} ${className}`}>{children}</div>;
}

/** Responsive bento grid — column count follows itemCount. */
export function BentoGrid({
  children,
  itemCount,
  className = "",
  id,
}: {
  children: ReactNode;
  itemCount?: number;
  className?: string;
  id?: string;
}) {
  const count = itemCount ?? (Array.isArray(children) ? children.length : 1);
  return (
    <div id={id} className={`${cardGridClassForCount(count, { bento: true })} ${className}`}>
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

