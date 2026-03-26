"use client";

import { useState } from "react";
import { CatalogImage } from "@/components/CatalogImage";

export function DeviceGallery({
  images,
  title,
}: {
  images: string[];
  title: string;
}) {
  const [active, setActive] = useState(images[0] ?? "");

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)]">
        <div className="relative flex aspect-[4/3] items-center justify-center">
          <CatalogImage
            src={active}
            alt={title}
            className="h-full w-full object-cover"
          />
        </div>
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {images.slice(0, 8).map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => setActive(image)}
              className={`relative aspect-square overflow-hidden rounded-xl border transition ${
                active === image
                  ? "border-[color:var(--aqua)] ring-1 ring-[color:var(--aqua)]"
                  : "border-[color:var(--line)] hover:border-[color:var(--nav-hover-border)]"
              }`}
              aria-label={`Show ${title} image ${index + 1}`}
            >
              <CatalogImage
                src={image}
                alt={`${title} ${index + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
