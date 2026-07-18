"use client";

import Link from "next/link";
import { bandFillClass } from "./primitives";

export function AnnouncementBar({
  message,
  href,
  bandFill = "accent",
}: {
  message: string;
  href?: string;
  bandFill?: "plain" | "subtle" | "accent";
}) {
  const inner = (
    <p className="text-center text-sm font-medium">{message}</p>
  );

  return (
    <div className={`${bandFillClass(bandFill)} py-2.5`}>
      <div className="content-rail">
        {href ? (
          <Link href={href} className="block hover:opacity-90">
            {inner}
          </Link>
        ) : (
          inner
        )}
      </div>
    </div>
  );
}
