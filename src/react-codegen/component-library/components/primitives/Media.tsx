"use client";

import type { CSSProperties } from "react";

export interface MediaProps {
  src: string;
  alt: string;
  className?: string;
  aspectRatio?: string;
  style?: CSSProperties;
}

export function Media({ src, alt, className = "", aspectRatio, style }: MediaProps) {
  const safeAlt = alt?.trim() || "Image";
  const img = (
    <img
      src={src}
      alt={safeAlt}
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
    />
  );

  if (aspectRatio) {
    return (
      <div className="relative overflow-hidden" style={{ aspectRatio }}>
        {img}
      </div>
    );
  }

  return img;
}
