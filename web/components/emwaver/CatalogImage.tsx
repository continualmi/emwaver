"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { getCatalogImageFallbackPath } from "@/lib/emwaver/catalogImageFallback";

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

  useEffect(() => {
    setCurrentSrc(preferredSrc);
  }, [preferredSrc]);

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
