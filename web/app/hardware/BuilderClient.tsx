"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type BomRow = Record<string, string>;

const LINK_FABRICATION_ROOT = "/hardware-catalog/hardware/pcb";
const BOM_URL = `${LINK_FABRICATION_ROOT}/BOM_EMWaver_2026-01-21.csv`;
const CPL_URL = `${LINK_FABRICATION_ROOT}/CPL_EMWaver_2026-01-21.csv`;
const GERBER_URL = `${LINK_FABRICATION_ROOT}/Gerber_EMWaver_2026-01-21.zip`;
const STL_URL = "/hardware-catalog/hardware/case/emwaver.stl";

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
  noIsmNoGpioNoUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_ism_no_gpio_no_usbfemale.png",
  noIsmNoGpioNoUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_ism_no_gpio_no_usbmale.png",
  noIrNoUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_usbmale.png",
  noIrNoUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_usbfemale.png",
  noIrNoGpioNoUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_gpio_no_usbmal.png",
  noIrNoGpioNoUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_gpio_no_usbfemale.png",
  noIrNoIsmNoUsbMale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_ism_no_maleusb.png",
  noIrNoIsmNoUsbFemale: "/hardware-catalog/hardware/emwaver/emwaver_no_ir_no_ism_no_usbfemale.png",
} as const;

const BOM_REMOVALS = {
  ir: new Set(["IR_REC1", "U2", "C3", "LED2", "Q1", "Q2", "R1", "R5", "R8", "R10", "R13", "R18"]),
  ism: new Set(["U1", "U5", "LED3", "R17"]),
  usbMale: new Set(["USB2", "R1"]),
  usbFemale: new Set(["USB-C1", "R11", "R12"]),
  gpio: new Set(["CN1", "U4"]),
};

const COST_MODEL = {
  baseRows: 9,
  baseCost2: 40,
  baseCost5: 55,
  dollarsPerRow: 3,
};

function stripQuotes(value: string): string {
  const trimmed = String(value || "").replace(/^\ufeff/, "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

function decodeUtf16Tsv(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-16le").decode(buffer);
}

function parseBom(text: string): { header: string[]; rows: BomRow[] } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split("\t").map(stripQuotes);
  const rows = lines.slice(1).map((line) => {
    const cols = line.split("\t").map(stripQuotes);
    return Object.fromEntries(header.map((key, index) => [key, cols[index] || ""]));
  });
  return { header, rows };
}

function parseDesignators(value: string): string[] {
  return stripQuotes(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeField(value: string): string {
  if (/[\t\r\n"]/g.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function encodeUtf16leWithBom(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
  }
  return bytes;
}

function formatCurrency(amount: number): string {
  return `$${amount}`;
}

function ToggleRow({
  checked,
  label,
  detail,
  onChange,
}: {
  checked: boolean;
  label: string;
  detail: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="group flex w-full items-center justify-between gap-4 py-3.5 text-left"
    >
      <div>
        <div
          className={`text-sm font-medium transition ${
            checked ? "text-[color:var(--ink)]" : "text-[color:var(--ink-dim)]"
          }`}
        >
          {label}
        </div>
        <div className="pt-0.5 text-xs text-[color:var(--ink-dim)]">{detail}</div>
      </div>
      <span
        className={`relative h-6 w-10 shrink-0 rounded-full transition ${
          checked
            ? "bg-[color:var(--aqua)]"
            : "bg-[color:var(--surface-2)] group-hover:bg-[color:var(--surface)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-[color:var(--paper)] transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export function BuilderClient() {
  const [gpio, setGpio] = useState(true);
  const [cc1101, setCc1101] = useState(true);
  const [ir, setIr] = useState(true);
  const [usbMale, setUsbMale] = useState(true);
  const [usbFemale, setUsbFemale] = useState(true);
  const [bomHeader, setBomHeader] = useState<string[]>([]);
  const [bomRows, setBomRows] = useState<BomRow[]>([]);
  const [bomError, setBomError] = useState<string>("");
  const [bomLoaded, setBomLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadBom() {
      try {
        const response = await fetch(BOM_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const parsed = parseBom(decodeUtf16Tsv(buffer));
        if (cancelled) return;
        setBomHeader(parsed.header);
        setBomRows(parsed.rows);
        setBomLoaded(true);
      } catch (error) {
        if (cancelled) return;
        setBomError(String((error as Error)?.message || error));
      }
    }

    void loadBom();
    return () => {
      cancelled = true;
    };
  }, []);

  function pickFeatureKey(): string {
    if (gpio && cc1101 && ir) return "all";
    if (!gpio && cc1101 && ir) return "noGpio";
    if (gpio && !cc1101 && ir) return "noIsm";
    if (!gpio && !cc1101 && ir) return "noIsmNoGpio";
    if (gpio && cc1101 && !ir) return "noIr";
    if (!gpio && cc1101 && !ir) return "noIrNoGpio";
    if (gpio && !cc1101 && !ir) return "noIsmNoIr";
    return "all";
  }

  function pickUsbKey(): string {
    if (usbMale && usbFemale) return "usbBoth";
    if (usbMale) return "usbMaleOnly";
    if (usbFemale) return "usbFemaleOnly";
    return "usbBoth";
  }

  function pickVariantKey(): string {
    return `${pickFeatureKey()}__${pickUsbKey()}`;
  }

  function pickImage(): string {
    const feature = pickFeatureKey();
    const usb = pickUsbKey();

    const map: Record<string, string> = {
      all__usbBoth: BOARD_IMAGES.all,
      all__usbMaleOnly: BOARD_IMAGES.noUsbFemale,
      all__usbFemaleOnly: BOARD_IMAGES.noUsbMale,
      noGpio__usbBoth: BOARD_IMAGES.noGpio,
      noGpio__usbMaleOnly: BOARD_IMAGES.noGpioNoUsbFemale,
      noGpio__usbFemaleOnly: BOARD_IMAGES.noGpioNoUsbMale,
      noIsm__usbBoth: BOARD_IMAGES.noIsm,
      noIsm__usbMaleOnly: BOARD_IMAGES.noIsmNoUsbFemale,
      noIsm__usbFemaleOnly: BOARD_IMAGES.noIsmNoUsbMale,
      noIsmNoGpio__usbBoth: BOARD_IMAGES.noIsmNoGpio,
      noIsmNoGpio__usbMaleOnly: BOARD_IMAGES.noIsmNoGpioNoUsbFemale,
      noIsmNoGpio__usbFemaleOnly: BOARD_IMAGES.noIsmNoGpioNoUsbMale,
      noIr__usbBoth: BOARD_IMAGES.noIr,
      noIr__usbMaleOnly: BOARD_IMAGES.noIrNoUsbFemale,
      noIr__usbFemaleOnly: BOARD_IMAGES.noIrNoUsbMale,
      noIrNoGpio__usbBoth: BOARD_IMAGES.noIrNoGpio,
      noIrNoGpio__usbMaleOnly: BOARD_IMAGES.noIrNoGpioNoUsbFemale,
      noIrNoGpio__usbFemaleOnly: BOARD_IMAGES.noIrNoGpioNoUsbMale,
      noIsmNoIr__usbBoth: BOARD_IMAGES.noIrNoIsm,
      noIsmNoIr__usbMaleOnly: BOARD_IMAGES.noIrNoIsmNoUsbFemale,
      noIsmNoIr__usbFemaleOnly: BOARD_IMAGES.noIrNoIsmNoUsbMale,
    };
    return map[`${feature}__${usb}`] || BOARD_IMAGES.all;
  }

  const filteredRows = bomRows.filter((row) => {
    const removals: Set<string>[] = [];
    if (!ir) removals.push(BOM_REMOVALS.ir);
    if (!cc1101) removals.push(BOM_REMOVALS.ism);
    if (!usbMale) removals.push(BOM_REMOVALS.usbMale);
    if (!usbFemale) removals.push(BOM_REMOVALS.usbFemale);
    if (!gpio) removals.push(BOM_REMOVALS.gpio);
    const designators = parseDesignators(row.Designator || "");
    return !designators.some((designator) => removals.some((set) => set.has(designator)));
  });

  const estimate = (() => {
    const rows = filteredRows.length;
    const delta = rows - COST_MODEL.baseRows;
    const two = Math.max(0, Math.round(COST_MODEL.baseCost2 + delta * COST_MODEL.dollarsPerRow));
    const five = Math.max(0, Math.round(COST_MODEL.baseCost5 + delta * COST_MODEL.dollarsPerRow));
    return { rows, two, five };
  })();

  function toggleFeature(
    key: "gpio" | "cc1101" | "ir" | "usbMale" | "usbFemale",
    next: boolean,
  ) {
    if (key === "gpio") {
      if (!next && !cc1101 && !ir) return;
      setGpio(next);
      return;
    }
    if (key === "cc1101") {
      if (!next && !gpio && !ir) return;
      setCc1101(next);
      return;
    }
    if (key === "ir") {
      if (!next && !gpio && !cc1101) return;
      setIr(next);
      return;
    }
    if (key === "usbMale") {
      if (!next && !usbFemale) return;
      setUsbMale(next);
      return;
    }
    if (!next && !usbMale) return;
    setUsbFemale(next);
  }

  function downloadFilteredBom() {
    if (!bomLoaded || bomError) {
      window.location.href = BOM_URL;
      return;
    }

    const rows = filteredRows;
    const tsv = [bomHeader, ...rows.map((row) => bomHeader.map((column) => escapeField(row[column] || "")))]
      .map((columns) => columns.join("\t"))
      .join("\r\n");

    const payload = encodeUtf16leWithBom(`${tsv}\r\n`);
    const payloadBytes = new Uint8Array(payload.byteLength);
    payloadBytes.set(payload);
    const blob = new Blob([payloadBytes], {
      type: "text/tab-separated-values;charset=utf-16le",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `BOM_EMWaver_2026-01-21__${pickVariantKey()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
  }

  const allOn = gpio && cc1101 && ir && usbMale && usbFemale;

  return (
    <section className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
      {/* ── Live preview (sticky on desktop) ── */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--image-well)]">
          <div className="relative h-[320px] w-full md:h-[440px]">
            <Image src={pickImage()} alt="EMWaver board preview" fill unoptimized className="object-contain p-4" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--ink-dim)]">
          <span>
            {bomLoaded ? `${filteredRows.length} BOM rows` : bomError ? "BOM unavailable" : "Loading BOM…"}
          </span>
          <span className="text-[color:var(--line)]">•</span>
          <span>~{formatCurrency(estimate.two)} for 2 pcs</span>
          <span className="text-[color:var(--line)]">•</span>
          <span>~{formatCurrency(estimate.five)} for 5 pcs</span>
        </div>
      </div>

      {/* ── Configuration ── */}
      <div className="space-y-8">
        {/* Sections */}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold text-[color:var(--ink)]">Sections</div>
            {!allOn && (
              <button
                type="button"
                onClick={() => { setGpio(true); setCc1101(true); setIr(true); setUsbMale(true); setUsbFemale(true); }}
                className="text-xs font-semibold text-[color:var(--aqua)] hover:underline"
              >
                Reset to full board
              </button>
            )}
          </div>
          <p className="pt-1 text-xs text-[color:var(--ink-dim)]">
            Toggle sections to customize the board. Keep at least one core feature
            and one USB connector.
          </p>
          <div className="mt-2 divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
            <ToggleRow checked={gpio} label="GPIO headers" detail="Board headers for module expansion." onChange={() => toggleFeature("gpio", !gpio)} />
            <ToggleRow checked={cc1101} label="CC1101 radio" detail="Sub-GHz radio section and antenna path." onChange={() => toggleFeature("cc1101", !cc1101)} />
            <ToggleRow checked={ir} label="Infrared RX/TX" detail="IR receiver, LEDs, and driver parts." onChange={() => toggleFeature("ir", !ir)} />
            <ToggleRow checked={usbMale} label="USB-C male" detail="Direct plug-in for phone-first use." onChange={() => toggleFeature("usbMale", !usbMale)} />
            <ToggleRow checked={usbFemale} label="USB-C female" detail="Cable-based desktop and bench use." onChange={() => toggleFeature("usbFemale", !usbFemale)} />
          </div>
        </div>

        {/* Downloads */}
        <div>
          <div className="text-sm font-semibold text-[color:var(--ink)]">Fabrication files</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <a href={GERBER_URL} className="rounded-xl bg-[color:var(--sky)] px-4 py-3 text-center text-sm font-semibold text-[color:var(--paper)] transition hover:opacity-90">
              Gerbers
            </a>
            <button type="button" onClick={downloadFilteredBom} className="rounded-xl bg-[color:var(--aqua)] px-4 py-3 text-sm font-semibold text-[color:var(--paper)] transition hover:opacity-90">
              BOM{!allOn ? " (filtered)" : ""}
            </button>
            <a href={CPL_URL} className="rounded-xl border border-[color:var(--line)] px-4 py-3 text-center text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)]">
              CPL
            </a>
            <a href={STL_URL} className="rounded-xl border border-[color:var(--line)] px-4 py-3 text-center text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--surface)]">
              Case STL
            </a>
          </div>
          <p className="pt-3 text-xs leading-6 text-[color:var(--ink-dim)]">
            Rough JLCPCB estimate: ~{formatCurrency(estimate.two)} for 2 pcs,
            ~{formatCurrency(estimate.five)} for 5 pcs — mostly per-part setup fees,
            about {formatCurrency(COST_MODEL.dollarsPerRow)} per BOM row over the
            base config. Quote on{" "}
            <a href="https://jlcpcb.com/quote" target="_blank" rel="noreferrer" className="text-[color:var(--sky)] hover:underline">JLCPCB</a>
            {" "}or{" "}
            <a href="https://jlc3dp.com/" target="_blank" rel="noreferrer" className="text-[color:var(--sky)] hover:underline">JLC3DP</a>.
          </p>
          {bomError && <div className="pt-2 text-xs text-[color:var(--danger)]">{bomError}</div>}
        </div>
      </div>
    </section>
  );
}
