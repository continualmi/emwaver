"use client";

import { useState } from "react";

export function DeviceGallery({
  images,
  title,
}: {
  images: string[];
  title: string;
}) {
  const [active, setActive] = useState(images[0] ?? "");

  return (
    <div className="overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)]">
      <div className="overflow-hidden bg-[rgba(3,7,18,0.45)]">
        <div className="relative flex aspect-[4/3] items-center justify-center">
          <img
            src={active}
            alt={title}
            className="max-h-full max-w-full object-contain p-6"
          />
        </div>
      </div>

      {images.length > 1 && (
        <div className="border-t border-[color:var(--line)] bg-[rgba(3,7,18,0.25)] p-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {images.map((image, index) => (
              <button
                key={image}
                type="button"
                onClick={() => setActive(image)}
                className={`shrink-0 overflow-hidden rounded-xl border transition ${
                  active === image
                    ? "border-[color:var(--aqua)] ring-1 ring-[color:var(--aqua)]"
                    : "border-[color:var(--line)] hover:border-[rgba(233,238,252,0.24)]"
                }`}
              >
                <div className="relative h-16 w-20 bg-[rgba(3,7,18,0.45)]">
                  <img
                    src={image}
                    alt={`${title} ${index + 1}`}
                    className="h-full w-full object-contain p-1"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
