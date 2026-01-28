"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type BomRow = Record<string, string>;

const BOM_REMOVALS = {
  ir: new Set([
    "IR_REC1",
    "U2",
    "C3",
    "LED2",
    "Q1",
    "Q2",
    "R1",
    "R5",
    "R8",
    "R10",
    "R13",
    "R18",
  ]),
  ism: new Set(["U1", "U5", "LED3", "R17"]),
  usbMale: new Set(["USB2", "R1"]),
  usbFemale: new Set(["USB-C1", "R11", "R12"]),
  gpio: new Set(["CN1", "U4"]),
};

const COST_ESTIMATE_MODEL = {
  baseRows: 9,
  baseCost2: 40,
  baseCost5: 55,
  dollarsPerRow: 3,
};

const BOARD_IMAGES = {
  all: "/hardware-catalog/hardware/emwaver/emwaver_all.png",
  allIso: "/hardware-catalog/downloads/emwaver.png",
  noGpio: "/hardware-catalog/hardware/emwaver/emwaver_no_gpio.png",
  noIsm: "/hardware-catalog/hardware/emwaver/emwaver_no_ism.png",
  noIsmNoGpio: "/hardware-catalog/hardware/emwaver/emwaver_no_ism_no_gpio.png",
  noIr: "/hardware-catalog/hardware/emwaver/emwaver_no_ir.png",
  noIrNoGpio: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_gpio.png",
  noIrNoIsm: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_ism.png",

  noUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_usbmale.png",
  noUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_usbfemale.png",

  noGpioNoUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_gpio_no_usbmale.png",
  noGpioNoUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_gpio_no_usbfemale.png",

  noIsmNoUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_ism_no_usbmale.png",
  noIsmNoUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_ism_no_usbfemale.png",

  noIsmNoGpioNoUsbFemale:
    "/hardware-catalog/hardware/emwaver/emwaver_no_ism_no_gpio_no_usbfemale.png",
  noIsmNoGpioNoUsbMale:
    "/hardware-catalog/hardware/emwaver/emwaver_no_ism_no_gpio_no_usbmale.png",

  noIrNoUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_usbmale.png",
  noIrNoUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_usbfemale.png",
  // Note: asset name uses "usbmal" (kept as-is).
  noIrNoGpioNoUsbMale:
    "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_gpio_no_usbmal.png",
  noIrNoGpioNoUsbFemale:
    "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_gpio_no_usbfemale.png",
  // Note: asset name uses "no_maleusb" (kept as-is).
  noIrNoIsmNoUsbMale:
    "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_ism_no_maleusb.png",
  noIrNoIsmNoUsbFemale:
    "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_ism_no_usbfemale.png",
};

const ALL_PHOTOSHOOT_IMAGES = [
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0149.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0150.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0153.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0142.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0130.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0143.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0146.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0147.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0148.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0151.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0152.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0154.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0156.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0160.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0162.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot/IMG_0164.webp",
];

const ALL_PHOTOSHOOT_MODULE_IMAGES = [
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0178.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0179.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0180.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0181.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0183.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0184.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0185.webp",
  "/hardware-catalog/hardware/emwaver_photoshoot_modules/IMG_0186.webp",
];

const VARIANT_GALLERY: Record<string, string[]> = {
  all__usbBoth: [
    BOARD_IMAGES.all,
    BOARD_IMAGES.allIso,
    ...ALL_PHOTOSHOOT_IMAGES,
    ...ALL_PHOTOSHOOT_MODULE_IMAGES,
  ],
  all__usbMaleOnly: [BOARD_IMAGES.noUsbFemale],
  all__usbFemaleOnly: [BOARD_IMAGES.noUsbMale],

  noGpio__usbBoth: [BOARD_IMAGES.noGpio],
  noGpio__usbMaleOnly: [BOARD_IMAGES.noGpioNoUsbFemale],
  noGpio__usbFemaleOnly: [BOARD_IMAGES.noGpioNoUsbMale],

  noIsm__usbBoth: [BOARD_IMAGES.noIsm],
  noIsm__usbMaleOnly: [BOARD_IMAGES.noIsmNoUsbFemale],
  noIsm__usbFemaleOnly: [BOARD_IMAGES.noIsmNoUsbMale],

  noIsmNoGpio__usbBoth: [BOARD_IMAGES.noIsmNoGpio],
  noIsmNoGpio__usbMaleOnly: [BOARD_IMAGES.noIsmNoGpioNoUsbFemale],
  noIsmNoGpio__usbFemaleOnly: [BOARD_IMAGES.noIsmNoGpioNoUsbMale],

  noIr__usbBoth: [BOARD_IMAGES.noIr],
  noIr__usbMaleOnly: [BOARD_IMAGES.noIrNoUsbFemale],
  noIr__usbFemaleOnly: [BOARD_IMAGES.noIrNoUsbMale],

  noIrNoGpio__usbBoth: [BOARD_IMAGES.noIrNoGpio],
  noIrNoGpio__usbMaleOnly: [BOARD_IMAGES.noIrNoGpioNoUsbFemale],
  noIrNoGpio__usbFemaleOnly: [BOARD_IMAGES.noIrNoGpioNoUsbMale],

  noIsmNoIr__usbBoth: [BOARD_IMAGES.noIrNoIsm],
  noIsmNoIr__usbMaleOnly: [BOARD_IMAGES.noIrNoIsmNoUsbFemale],
  noIsmNoIr__usbFemaleOnly: [BOARD_IMAGES.noIrNoIsmNoUsbMale],
};

const NON_CUSTOMIZE_GALLERY = [
  ...ALL_PHOTOSHOOT_IMAGES,
  ...ALL_PHOTOSHOOT_MODULE_IMAGES,
  BOARD_IMAGES.all,
  BOARD_IMAGES.allIso,
];

function parseDesignators(designatorField: string): string[] {
  const raw = String(designatorField ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function rowMatchesRemovalSets(row: BomRow, sets: Set<string>[]): boolean {
  const designators = parseDesignators(row?.Designator || "");
  for (const d of designators) {
    for (const s of sets) {
      if (s.has(d)) return true;
    }
  }
  return false;
}

function decodeUtf16Tsv(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let encoding: "utf-16le" | "utf-16be" = "utf-16le";
  if (bytes.length >= 2) {
    const b0 = bytes[0];
    const b1 = bytes[1];
    if (b0 === 0xfe && b1 === 0xff) encoding = "utf-16be";
    if (b0 === 0xff && b1 === 0xfe) encoding = "utf-16le";
  }
  const decoder = new TextDecoder(encoding);
  return decoder.decode(buf);
}

function stripQuotes(x: string): string {
  const s = String(x ?? "").trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function parseBomTsv(text: string): { header: string[]; rows: BomRow[] } {
  const lines = String(text)
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };

  const header = lines[0].split("\t").map(stripQuotes);
  const rows: BomRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t").map(stripQuotes);
    const row: BomRow = {};
    for (let i = 0; i < header.length; i++) row[header[i] as string] = cols[i] ?? "";
    rows.push(row);
  }
  return { header, rows };
}

function tsvEscapeField(v: string): string {
  const s = String(v ?? "");
  if (/[\t\r\n"]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function bomRowsToTsv(header: string[], rows: BomRow[]): string {
  const out: string[] = [];
  out.push(header.map(tsvEscapeField).join("\t"));
  for (const r of rows) {
    out.push(header.map((h) => tsvEscapeField(r?.[h] ?? "")).join("\t"));
  }
  return out.join("\r\n") + "\r\n";
}

function encodeUtf16leWithBom(s: string): Uint8Array {
  const str = String(s ?? "");
  const buf = new Uint8Array(2 + str.length * 2);
  buf[0] = 0xff;
  buf[1] = 0xfe;
  for (let i = 0; i < str.length; i++) {
    const codeUnit = str.charCodeAt(i);
    buf[2 + i * 2] = codeUnit & 0xff;
    buf[2 + i * 2 + 1] = (codeUnit >> 8) & 0xff;
  }
  return buf;
}

function downloadBytes(filename: string, bytes: Uint8Array, mimeType: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy as unknown as BlobPart], {
    type: mimeType || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function estimateCostFromRowCount(rowCount: number): { two: number; five: number } {
  const n = Number(rowCount || 0);
  const delta = n - COST_ESTIMATE_MODEL.baseRows;
  const two = COST_ESTIMATE_MODEL.baseCost2 + COST_ESTIMATE_MODEL.dollarsPerRow * delta;
  const five = COST_ESTIMATE_MODEL.baseCost5 + COST_ESTIMATE_MODEL.dollarsPerRow * delta;
  return {
    two: Math.max(0, Math.round(two)),
    five: Math.max(0, Math.round(five)),
  };
}

export function OrderClient() {
  const [customize, setCustomize] = useState(false);

  const [gpio, setGpio] = useState(true);
  const [cc1101, setCc1101] = useState(true);
  const [ir, setIr] = useState(true);
  const [usbMale, setUsbMale] = useState(true);
  const [usbFemale, setUsbFemale] = useState(true);

  const [featureMsg, setFeatureMsg] = useState<string | null>(null);
  const [usbMsg, setUsbMsg] = useState<string | null>(null);

  const [bomHeader, setBomHeader] = useState<string[]>([]);
  const [bomRows, setBomRows] = useState<BomRow[]>([]);
  const [bomLoaded, setBomLoaded] = useState(false);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomError, setBomError] = useState<string | null>(null);

  const [selectedHeroByVariant, setSelectedHeroByVariant] = useState<Record<string, string>>({});

  const featureFlashTimer = useRef<number | null>(null);
  const usbFlashTimer = useRef<number | null>(null);

  const variantKey = useMemo(() => {
    if (!customize) return "all__usbBoth";

    const featureKey = (() => {
      if (gpio && cc1101 && ir) return "all";
      if (!gpio && cc1101 && ir) return "noGpio";
      if (gpio && !cc1101 && ir) return "noIsm";
      if (!gpio && !cc1101 && ir) return "noIsmNoGpio";
      if (gpio && cc1101 && !ir) return "noIr";
      if (!gpio && cc1101 && !ir) return "noIrNoGpio";
      if (gpio && !cc1101 && !ir) return "noIsmNoIr";
      return "all";
    })();

    const usbKey = (() => {
      if (usbMale && usbFemale) return "usbBoth";
      if (usbMale && !usbFemale) return "usbMaleOnly";
      if (!usbMale && usbFemale) return "usbFemaleOnly";
      return "usbBoth";
    })();

    return `${featureKey}__${usbKey}`;
  }, [cc1101, customize, gpio, ir, usbFemale, usbMale]);

  const variantStateKey = useMemo(() => {
    return customize ? variantKey : `${variantKey}__default`;
  }, [customize, variantKey]);

  const gallery = useMemo(() => {
    if (!customize && variantKey === "all__usbBoth") return NON_CUSTOMIZE_GALLERY;
    if (VARIANT_GALLERY[variantKey]) return VARIANT_GALLERY[variantKey];
    const [featureKey] = String(variantKey).split("__");
    const featureFallback = `${featureKey}__usbBoth`;
    if (VARIANT_GALLERY[featureFallback]) return VARIANT_GALLERY[featureFallback];
    return VARIANT_GALLERY.all__usbBoth;
  }, [customize, variantKey]);

  const heroSrc = useMemo(() => {
    const preferred = selectedHeroByVariant[variantStateKey];
    if (preferred && gallery.includes(preferred)) return preferred;
    return gallery[0] || BOARD_IMAGES.all;
  }, [gallery, selectedHeroByVariant, variantStateKey]);

  const ensureBomLoaded = async () => {
    if (bomLoaded || bomLoading) return;
    setBomLoading(true);
    setBomError(null);
    try {
      const url = "/hardware-catalog/hardware/pcb/BOM_EMWaver_2026-01-21.csv";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const text = decodeUtf16Tsv(buf);
      const parsed = parseBomTsv(text);
      setBomHeader(parsed.header);
      setBomRows(parsed.rows);
      setBomLoaded(true);
    } catch (e) {
      setBomError(String((e as any)?.message || e));
    } finally {
      setBomLoading(false);
    }
  };

  const filteredRows = useMemo(() => {
    if (!bomLoaded) return [];

    const removalSets: Set<string>[] = [];
    if (!ir) removalSets.push(BOM_REMOVALS.ir);
    if (!cc1101) removalSets.push(BOM_REMOVALS.ism);
    if (!usbMale) removalSets.push(BOM_REMOVALS.usbMale);
    if (!usbFemale) removalSets.push(BOM_REMOVALS.usbFemale);
    if (!gpio) removalSets.push(BOM_REMOVALS.gpio);

    return bomRows.filter((r) => !rowMatchesRemovalSets(r, removalSets));
  }, [bomLoaded, bomRows, cc1101, gpio, ir, usbFemale, usbMale]);

  const bomRowsForCost = useMemo(() => {
    if (!bomLoaded) return [];
    if (!customize) return bomRows;
    return filteredRows;
  }, [bomLoaded, bomRows, customize, filteredRows]);

  const cost = useMemo(() => {
    if (!customize) return null;
    if (bomError) return { state: "error" as const };
    if (!bomLoaded) return { state: "loading" as const };
    const est = estimateCostFromRowCount(bomRowsForCost.length);
    return { state: "ok" as const, ...est };
  }, [bomError, bomLoaded, bomRowsForCost.length, customize]);

  useEffect(() => {
    if (!customize) {
      setFeatureMsg(null);
      setUsbMsg(null);
    }
  }, [customize]);

  const flash = (kind: "feature" | "usb", message: string) => {
    if (kind === "feature") {
      setFeatureMsg(message);
      if (featureFlashTimer.current) window.clearTimeout(featureFlashTimer.current);
      featureFlashTimer.current = window.setTimeout(() => setFeatureMsg(null), 1800);
    } else {
      setUsbMsg(message);
      if (usbFlashTimer.current) window.clearTimeout(usbFlashTimer.current);
      usbFlashTimer.current = window.setTimeout(() => setUsbMsg(null), 1800);
    }
  };

  const enforceUsbAtLeastOne = (changed: "male" | "female") => {
    if (!customize) return;
    if (!usbMale && !usbFemale) {
      if (changed === "male") setUsbMale(true);
      else setUsbFemale(true);
      flash("usb", "Pick at least one USB-C connector (male or female). ");
    }
  };

  const enforceFeaturesAtLeastOne = (changed: "gpio" | "cc1101" | "ir") => {
    if (!customize) return;
    if (!gpio && !cc1101 && !ir) {
      if (changed === "gpio") setGpio(true);
      else if (changed === "cc1101") setCc1101(true);
      else setIr(true);
      flash("feature", "Pick at least one feature: GPIO, Sub-GHz, or Infrared.");
    }
  };

  const onToggleGpio = () => {
    setGpio((v) => !v);
    window.setTimeout(() => enforceFeaturesAtLeastOne("gpio"), 0);
  };
  const onToggleCc1101 = () => {
    setCc1101((v) => !v);
    window.setTimeout(() => enforceFeaturesAtLeastOne("cc1101"), 0);
  };
  const onToggleIr = () => {
    setIr((v) => !v);
    window.setTimeout(() => enforceFeaturesAtLeastOne("ir"), 0);
  };
  const onToggleUsbMale = () => {
    setUsbMale((v) => !v);
    window.setTimeout(() => enforceUsbAtLeastOne("male"), 0);
  };
  const onToggleUsbFemale = () => {
    setUsbFemale((v) => !v);
    window.setTimeout(() => enforceUsbAtLeastOne("female"), 0);
  };

  const downloadFilteredBom = async () => {
    const href = "/hardware-catalog/hardware/pcb/BOM_EMWaver_2026-01-21.csv";
    await ensureBomLoaded();
    if (bomError || !bomLoaded) {
      window.location.href = href;
      return;
    }

    const filename = `BOM_EMWaver_2026-01-21__${variantKey}.csv`;
    const tsv = bomRowsToTsv(bomHeader, filteredRows);
    const bytes = encodeUtf16leWithBom(tsv);
    downloadBytes(filename, bytes, "text/tab-separated-values;charset=utf-16le");
  };

  const selectHero = (src: string) => {
    setSelectedHeroByVariant((prev) => ({ ...prev, [variantStateKey]: src }));
  };

  // Trigger BOM loading only when customize is enabled.
  useEffect(() => {
    if (!customize) return;
    void ensureBomLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customize]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink)] md:text-5xl">
            Order from JLCPCB
          </h1>
          <p className="pt-2 text-[15px] text-[color:var(--ink-dim)]">
            Choose what gets assembled, then download the PCB/BOM/CPL files.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="https://jlcpcb.com/"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
          >
            JLCPCB
          </a>
          <a
            href="https://jlc3dp.com/"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
          >
            JLC3DP
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                Customize
              </div>
              <div className="pt-1 text-sm text-[color:var(--ink-dim)]">
                Toggle options to generate a filtered BOM.
              </div>
            </div>

            <label className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--ink)]">
              <input
                type="checkbox"
                checked={customize}
                onChange={(e) => setCustomize(e.target.checked)}
              />
              Enable
            </label>
          </div>

          {customize ? (
            <div className="mt-6 space-y-5">
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[color:var(--ink)]">
                    Features
                  </div>
                  {featureMsg ? (
                    <div className="text-xs font-semibold text-[color:var(--danger)]">
                      {featureMsg}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <label className="flex items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[color:var(--ink)]">
                    <input type="checkbox" checked={gpio} onChange={onToggleGpio} />
                    GPIO
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[color:var(--ink)]">
                    <input type="checkbox" checked={cc1101} onChange={onToggleCc1101} />
                    Sub-GHz
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[color:var(--ink)]">
                    <input type="checkbox" checked={ir} onChange={onToggleIr} />
                    Infrared
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[color:var(--ink)]">USB-C</div>
                  {usbMsg ? (
                    <div className="text-xs font-semibold text-[color:var(--danger)]">
                      {usbMsg}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[color:var(--ink)]">
                    <input type="checkbox" checked={usbMale} onChange={onToggleUsbMale} />
                    Male
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[color:var(--ink)]">
                    <input type="checkbox" checked={usbFemale} onChange={onToggleUsbFemale} />
                    Female
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.6)] p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-[color:var(--ink)]">Filtered BOM</div>
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-2 py-0.5 text-xs text-[color:var(--ink-dim)]">
                    {bomError ? "?" : bomLoaded ? String(filteredRows.length) : "..."}
                  </div>
                </div>
                <div className="mt-2 text-xs text-[color:var(--ink-dim)]">
                  Count is the number of BOM rows after filtering.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={downloadFilteredBom}
                    className="rounded-xl bg-[color:var(--ink)] px-4 py-2 text-xs font-semibold text-[color:var(--paper)] hover:opacity-95"
                  >
                    Download filtered BOM
                  </button>
                  <a
                    className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
                    href="/hardware-catalog/hardware/pcb/BOM_EMWaver_2026-01-21.csv"
                  >
                    Original BOM
                  </a>
                </div>

                {cost ? (
                  <div className="mt-4 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
                    <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
                      Rough assembly estimate
                    </div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-3">
                        <div className="text-xs text-[color:var(--ink-dim)]">2 units</div>
                        <div className="pt-1 text-lg font-semibold text-[color:var(--ink)]">
                          {cost.state === "ok" ? `$${cost.two}` : cost.state === "loading" ? "..." : "?"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-3">
                        <div className="text-xs text-[color:var(--ink-dim)]">5 units</div>
                        <div className="pt-1 text-lg font-semibold text-[color:var(--ink)]">
                          {cost.state === "ok" ? `$${cost.five}` : cost.state === "loading" ? "..." : "?"}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-6 text-sm text-[color:var(--ink-dim)]">
              Customization is off. You’re looking at a fully-populated build.
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-3xl border border-[color:var(--line)] bg-[color:var(--surface)]">
            <img src={heroSrc} alt="" className="h-auto w-full object-cover" />
          </div>

          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-5">
            <div className="text-xs font-semibold tracking-wide text-[color:var(--ink-dim)]">
              Gallery
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {gallery.slice(0, 16).map((src) => {
                const active = src === heroSrc;
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => selectHero(src)}
                    className={`board-thumb shrink-0 overflow-hidden rounded-xl border ${
                      active
                        ? "border-white/25 bg-white/10"
                        : "border-[color:var(--line)] bg-[color:var(--surface)] hover:bg-[color:var(--surface-2)]"
                    }`}
                    aria-label="Select image"
                  >
                    <img src={src} alt="" className="h-16 w-16 object-cover" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-5">
            <div className="text-sm font-semibold text-[color:var(--ink)]">Downloads</div>
            <div className="mt-3 grid gap-2">
              <a
                href="/hardware-catalog/hardware/pcb/Gerber_EMWaver_2026-01-21.zip"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                Gerbers (ZIP)
              </a>
              <a
                href="/hardware-catalog/hardware/pcb/CPL_EMWaver_2026-01-21.csv"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                CPL (pick-and-place)
              </a>
              <a
                href="/hardware-catalog/hardware/pcb/BOM_EMWaver_2026-01-21.csv"
                className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--surface-2)]"
              >
                BOM
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
