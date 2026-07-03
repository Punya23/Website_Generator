"use client";

import Link from "next/link";

export function AnnouncementBar({
  message,
  href,
}: {
  message: string;
  href?: string;
}) {
  const inner = (
    <p className="text-center text-sm font-medium text-nav-active-text">{message}</p>
  );

  return (
    <div className="bg-accent py-2.5 text-nav-active-text">
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
