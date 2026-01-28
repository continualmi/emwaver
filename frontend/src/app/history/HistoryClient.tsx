"use client";

import { useMemo, useState } from "react";
import type { HardwareCatalogDevice } from "@/lib/hardwareCatalog/types";
import {
  normalizeDeviceImages,
  prettyDesignDate,
  prettyTitle,
  resolveDeviceHero,
} from "@/lib/hardwareCatalog/shared";

type Props = {
  devices: HardwareCatalogDevice[];
};

type LightboxState =
  | {
      open: true;
      title: string;
      images: string[];
      index: number;
    }
  | { open: false };

export function HistoryClient({ devices }: Props) {
  const [lb, setLb] = useState<LightboxState>({ open: false });

  const items = useMemo(() => {
    return devices.map((d) => {
      const title = prettyTitle(d.displayTitle || d.title || d.folder);
      const designDate = prettyDesignDate(d.designDate || d.date);
      const hero = resolveDeviceHero(d);
      const images = normalizeDeviceImages(d);
      return { device: d, title, designDate, hero, images };
    });
  }, [devices]);

  const openAt = (title: string, images: string[], index: number) => {
    if (!images.length) return;
    const safeIndex = Number.isFinite(index)
      ? Math.max(0, Math.min(images.length - 1, index))
      : 0;
    setLb({ open: true, title, images, index: safeIndex });
  };

  const close = () => setLb({ open: false });
  const prev = () => {
    if (!lb.open) return;
    setLb({ ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length });
  };
  const next = () => {
    if (!lb.open) return;
    setLb({ ...lb, index: (lb.index + 1) % lb.images.length });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
            History
          </h1>
          <p className="pt-2 text-[15px] text-[color:var(--ink-dim)]">
            A chronological archive of EMWaver prototypes (photos + metadata).
          </p>
        </div>
        <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--ink-dim)]">
          {devices.length} prototypes
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {items.map(({ device, title, designDate, hero, images }) => {
          const thumbs = images.slice(0, 7);
          const moreCount = Math.max(0, images.length - thumbs.length);
          return (
            <article
              key={device.folder}
              className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] overflow-hidden"
            >
              <div className="p-6 md:p-8">
                <div className="grid gap-6 md:grid-cols-[360px_minmax(0,1fr)]">
                  <button
                    type="button"
                    onClick={() => openAt(title, images, 0)}
                    className="group relative overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.6)] text-left"
                    aria-label={`Open gallery for ${title}`}
                  >
                    <img
                      src={hero}
                      alt={title}
                      className="h-[240px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  </button>

                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-dim)]">
                      Design: {designDate}
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[color:var(--ink)] md:text-3xl">
                      {title}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-[color:var(--ink-dim)]">
                      {device.description || "Description coming soon."}
                    </p>

                    <div className="mt-6 flex items-center justify-between gap-3">
                      <div className="text-xs text-[color:var(--ink-dim)]">Photos</div>
                      <div className="text-xs text-[color:var(--ink-dim)]">
                        {images.length} image{images.length === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {thumbs.map((src, idx) => (
                        <button
                          key={`${device.folder}:${src}`}
                          type="button"
                          onClick={() => openAt(title, images, idx)}
                          className="relative shrink-0 h-16 w-16 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] hover:bg-[color:var(--surface-2)]"
                          title={idx === 0 ? "Hero" : `Photo ${idx + 1}`}
                        >
                          <img
                            src={src}
                            alt={`${title} thumbnail ${idx + 1}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                      {moreCount > 0 ? (
                        <div className="shrink-0 flex items-center justify-center h-16 w-16 rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.04)] text-xs font-semibold text-[color:var(--ink)]">
                          +{moreCount}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {lb.open ? (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={close}
        >
          <div
            className="mx-auto flex h-full max-w-6xl flex-col gap-3 px-4 py-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{lb.title}</div>
                <div className="text-xs text-white/70">
                  {lb.index + 1} / {lb.images.length}
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15"
              >
                Close
              </button>
            </div>

            <div className="relative flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
              <img
                src={lb.images[lb.index]}
                alt=""
                className="h-full w-full object-contain"
              />
              {lb.images.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={prev}
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-2xl border border-white/10 bg-white/10 text-white hover:bg-white/15"
                    aria-label="Previous"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-2xl border border-white/10 bg-white/10 text-white hover:bg-white/15"
                    aria-label="Next"
                  >
                    ›
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
