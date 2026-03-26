"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { getCatalogImageFallbackPath } from "@/lib/catalogImageFallback";

export function CatalogImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const preferredSrc = getCatalogImageFallbackPath(src) ?? src;
  const [currentSrc, setCurrentSrc] = useState(preferredSrc);

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={() => {
        if (currentSrc !== src) {
          setCurrentSrc(src);
          return;
        }

        const fallback = getCatalogImageFallbackPath(src);
        if (!fallback || fallback === currentSrc) return;
        setCurrentSrc(fallback);
      }}
    />
  );
}
