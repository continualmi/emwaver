"use client";

import { useState } from "react";
import { CatalogImage } from "@/components/emwaver/CatalogImage";

export function GalleryClient({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(images[0] || "");

  return (
    <div className="overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface-3)] p-3 md:p-4">
      <div className="overflow-hidden rounded-[1.35rem] border border-[color:var(--line)] bg-[color:var(--image-well)]">
        <div className="relative h-[320px] w-full md:h-[460px]">
          <CatalogImage src={active} alt={title} className="h-full w-full object-contain object-center" />
        </div>
      </div>

      {images.length > 1 ? (
        <div className="mt-3 overflow-hidden rounded-[1.35rem] border border-[color:var(--line)] bg-[color:var(--surface-3)] px-2 py-2">
          <div className="flex max-w-full gap-3 overflow-x-auto pb-1">
            {images.map((image, index) => (
              <button
                key={image}
                type="button"
                onClick={() => setActive(image)}
                className={`shrink-0 overflow-hidden rounded-2xl border transition ${
                  active === image
                    ? "border-[color:var(--aqua)] bg-[color:var(--aqua-tint)]"
                    : "border-[color:var(--line)] bg-[color:var(--surface)] hover:bg-[color:var(--surface-2)]"
                }`}
              >
                <div className="relative h-20 w-24 bg-[color:var(--image-well)]">
                  <CatalogImage
                    src={image}
                    alt={`${title} ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
