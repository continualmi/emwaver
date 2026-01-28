/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode, WheelEvent as ReactWheelEvent } from "react";
import type { ScriptTree } from "../../utils/ScriptEngine";

import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

function ScriptPlot({
  node,
  onInvokeCallback,
}: {
  node: ScriptTree;
  onInvokeCallback?: (token: string, args: unknown[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const lastCursorEmitAtRef = useRef<number>(0);
  const onInvokeRef = useRef<((token: string, args: unknown[]) => void) | undefined>(undefined);
  const handlersRef = useRef<{ viewport?: string; select?: string; cursor?: string }>({});
  const yRangeRef = useRef<{ yMin: number; yMax: number }>({ yMin: -128, yMax: 384 });

  const props = (node.props || {}) as any;
  const handlers = (node as any).handlers || {};

  const dataX = Array.isArray(props.dataX) ? (props.dataX as number[]) : [];
  const dataY = Array.isArray(props.dataY) ? (props.dataY as number[]) : [];

  const height = typeof props.height === "number" ? props.height : 400;
  const yMin = typeof props.yMin === "number" ? props.yMin : -128;
  const yMax = typeof props.yMax === "number" ? props.yMax : 384;
  const xMinProp = typeof props.xMin === "number" ? props.xMin : undefined;
  const xMaxProp = typeof props.xMax === "number" ? props.xMax : undefined;

  const overlayText = typeof props.overlayText === "string" ? props.overlayText : null;
  const errorText = typeof props.errorText === "string" ? props.errorText : null;

  // Keep uPlot hooks stable across React renders.
  onInvokeRef.current = onInvokeCallback;
  handlersRef.current = {
    viewport: handlers.viewport,
    select: handlers.select,
    cursor: handlers.cursor,
  };
  yRangeRef.current = { yMin, yMax };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const plot = new uPlot(
      {
        width: 800,
        height,
        legend: { show: false },
        cursor: { focus: { prox: 16 } },
        select: { show: true, left: 0, top: 0, width: 0, height: 0 },
        axes: [
          { stroke: "#cbd5e1", grid: { stroke: "#334155" } },
          { stroke: "#cbd5e1", grid: { stroke: "#334155" } },
        ],
        scales: {
          x: { time: false },
          y: {
            time: false,
            range: () => {
              const r = yRangeRef.current;
              return [r.yMin, r.yMax];
            },
          },
        },
        series: [
          {},
          {
            label: "Signal",
            stroke: "#01579B",
            width: 2,
          },
        ],
        hooks: {
          setScale: [
            (u, key) => {
              if (key !== "x") return;
              const token = handlersRef.current.viewport;
              const invoke = onInvokeRef.current;
              if (!token || !invoke) return;
              const scale = u.scales.x;
              invoke(token, [{ min: scale.min, max: scale.max }]);
            },
          ],
          setSelect: [
            (u) => {
              const token = handlersRef.current.select;
              const invoke = onInvokeRef.current;
              if (!token || !invoke) return;
              const sel = u.select;
              if (!sel || sel.width <= 0) return;
              const left = sel.left;
              const right = sel.left + sel.width;
              const min = u.posToVal(left, "x");
              const max = u.posToVal(right, "x");
              invoke(token, [{ min, max }]);
            },
          ],
          setCursor: [
            (u) => {
              const token = handlersRef.current.cursor;
              const invoke = onInvokeRef.current;
              if (!token || !invoke) return;
              const now = Date.now();
              if (now - lastCursorEmitAtRef.current < 80) return;
              lastCursorEmitAtRef.current = now;
              const idx = u.cursor.idx;
              if (idx == null || idx < 0) return;
              const x = u.data[0]?.[idx] as number | undefined;
              const y = u.data[1]?.[idx] as number | undefined;
              invoke(token, [{ idx, x, y }]);
            },
          ],
        },
      },
      [new Float64Array(), new Float32Array()],
      root,
    );
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      const w = root.clientWidth || 800;
      const h = root.clientHeight || height;
      try {
        plot.setSize({ width: w, height: h });
      } catch {
        // ignore
      }
    });
    ro.observe(root);

    return () => {
      ro.disconnect();
      try {
        plot.destroy();
      } catch {
        // ignore
      }
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const xs = new Float64Array(dataX);
    const ys = new Float32Array(dataY);
    try {
      plot.setData([xs, ys]);
    } catch {
      // ignore
    }
  }, [dataX, dataY]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    if (xMinProp == null || xMaxProp == null) return;
    try {
      plot.setScale("x", { min: xMinProp, max: xMaxProp });
    } catch {
      // ignore
    }
  }, [xMinProp, xMaxProp]);

  const handleWheelCapture = (event: ReactWheelEvent<HTMLDivElement>) => {
    const plot = plotRef.current;
    if (!plot) return;

    // Keep wheel inside the plot (otherwise the surrounding script scroll view wins).
    event.preventDefault();
    event.stopPropagation();
    (event.nativeEvent as any)?.stopImmediatePropagation?.();

    const scale = plot.scales.x;
    const min0 = typeof scale.min === "number" && Number.isFinite(scale.min) ? scale.min : undefined;
    const max0 = typeof scale.max === "number" && Number.isFinite(scale.max) ? scale.max : undefined;
    if (min0 == null || max0 == null || max0 <= min0) return;

    // Exponential zoom feels better on trackpads.
    const z = Math.exp(event.deltaY * 0.001);
    const nextRange = (max0 - min0) * z;
    if (!Number.isFinite(nextRange) || nextRange <= 0) return;

    const rect = (plot.root as HTMLElement).getBoundingClientRect();
    const xPx = event.clientX - rect.left - plot.bbox.left;
    const anchor = plot.posToVal(xPx, "x");

    const t = (anchor - min0) / (max0 - min0);
    const clampedT = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5;

    const nextMin = anchor - clampedT * nextRange;
    const nextMax = nextMin + nextRange;
    if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMax <= nextMin) return;

    try {
      plot.setScale("x", { min: nextMin, max: nextMax });
    } catch {
      // ignore
    }
  };

  // Ensure scroll containers can't steal wheel while hovering the plot.
  // Attaching at window capture is the most reliable in nested layouts.
  useEffect(() => {
    const handleWheel: EventListener = (event) => {
      const plot = plotRef.current;
      if (!plot) return;

      const e = event as WheelEvent;
      const target = e.target as Node | null;
      if (!target || !plot.root || !plot.root.contains(target)) return;

      // Don't block ctrl+wheel page zoom.
      if (e.ctrlKey) return;

      // Prevent scroll in any ancestor and zoom the plot instead.
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();

      const scale = plot.scales.x;
      const min0 = typeof scale.min === "number" && Number.isFinite(scale.min) ? scale.min : undefined;
      const max0 = typeof scale.max === "number" && Number.isFinite(scale.max) ? scale.max : undefined;
      if (min0 == null || max0 == null || max0 <= min0) return;

      const z = Math.exp(e.deltaY * 0.001);
      const nextRange = (max0 - min0) * z;
      if (!Number.isFinite(nextRange) || nextRange <= 0) return;

      const rect = (plot.root as HTMLElement).getBoundingClientRect();
      const xPx = e.clientX - rect.left - plot.bbox.left;
      const anchor = plot.posToVal(xPx, "x");

      const t = (anchor - min0) / (max0 - min0);
      const clampedT = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5;

      const nextMin = anchor - clampedT * nextRange;
      const nextMax = nextMin + nextRange;
      if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMax <= nextMin) return;

      try {
        plot.setScale("x", { min: nextMin, max: nextMax });
      } catch {
        // ignore
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    // Legacy fallback just in case WebView maps trackpad to mousewheel.
    window.addEventListener("mousewheel", handleWheel as any, { passive: false, capture: true } as any);

    return () => {
      window.removeEventListener("wheel", handleWheel, { capture: true } as any);
      window.removeEventListener("mousewheel", handleWheel as any, { capture: true } as any);
    };
  }, []);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    try {
      plot.redraw();
    } catch {
      // ignore
    }
  }, [yMin, yMax]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div
        ref={rootRef}
        className="h-full w-full"
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
        onWheelCapture={handleWheelCapture}
      />
      {errorText ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-slate-200">
          <p>Chart error: {errorText}</p>
        </div>
      ) : null}
      {overlayText ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-[11px] text-slate-200 backdrop-blur">
          {overlayText}
        </div>
      ) : null}
    </div>
  );
}

export default function ScriptUIRenderer({
  tree,
  onInvokeCallback,
}: {
  tree: ScriptTree;
  onInvokeCallback?: (token: string, args: unknown[]) => void;
}) {
  const [inputValues, setInputValues] = useState<Record<string, any>>({});

  const resolvePadding = (value: unknown): React.CSSProperties | undefined => {
    if (typeof value === "number") {
      return { padding: `${value}px` };
    }
    if (value && typeof value === "object") {
      const raw = value as {
        top?: number;
        bottom?: number;
        leading?: number;
        trailing?: number;
        left?: number;
        right?: number;
      };
      const top = raw.top ?? 0;
      const bottom = raw.bottom ?? 0;
      const left = raw.left ?? raw.leading ?? 0;
      const right = raw.right ?? raw.trailing ?? 0;
      return {
        paddingTop: `${top}px`,
        paddingBottom: `${bottom}px`,
        paddingLeft: `${left}px`,
        paddingRight: `${right}px`,
      };
    }
    return undefined;
  };

  const renderNode = (node: ScriptTree): ReactNode => {
    const props = node.props || {};
    const children = node.children || [];
    const handlers = (node as any).handlers || {};
    const nodeId = (props.id as string) || "node";
    const paddingStyle = resolvePadding((props as any).padding);

    const resolveFontClass = () => {
      const font = (props as any).font;
      const fontWeight = (props as any).fontWeight;
      const fontFamily = (props as any).fontFamily;
      const monospace = Boolean((props as any).monospace) || fontFamily === "monospace";

      const classes: string[] = [];

      // Lightweight typography mapping (kept intentionally small).
      if (font === "title" || font === "largeTitle") classes.push("text-2xl");
      else if (font === "title2") classes.push("text-xl");
      else if (font === "title3") classes.push("text-lg");
      else if (font === "caption") classes.push("text-xs");
      else classes.push("text-sm");

      if (fontWeight === "semibold") classes.push("font-semibold");
      else if (fontWeight === "medium") classes.push("font-medium");
      else if (fontWeight === "bold") classes.push("font-bold");

      if (monospace) classes.push("font-mono");
      return classes.join(" ");
    };

    switch (node.type) {
      case "column": {
        const spacing = (props.spacing as number) || 12;
        const padding = (props.padding as number) || 0;
        const backgroundColor = props.backgroundColor as string | undefined;
        const borderColor = (props as any).borderColor as string | undefined;
        const cornerRadius = (props as any).cornerRadius as number | undefined;
        return (
          <div
            className="flex flex-col"
            style={{
              gap: `${spacing}px`,
              padding: `${padding}px`,
              width: "100%",
              backgroundColor,
              border: borderColor ? `1px solid ${borderColor}` : undefined,
              borderRadius: typeof cornerRadius === "number" ? `${cornerRadius}px` : undefined,
            }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case "row": {
        const spacing = (props.spacing as number) || 8;
        const backgroundColor = props.backgroundColor as string | undefined;
        const borderColor = (props as any).borderColor as string | undefined;
        const cornerRadius = (props as any).cornerRadius as number | undefined;
        return (
          <div
            className="flex w-full"
            style={{
              gap: `${spacing}px`,
              backgroundColor,
              border: borderColor ? `1px solid ${borderColor}` : undefined,
              borderRadius: typeof cornerRadius === "number" ? `${cornerRadius}px` : undefined,
              ...paddingStyle,
            }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case "button": {
        const handleClick = () => {
          if (handlers.tap && onInvokeCallback) {
            onInvokeCallback(handlers.tap, []);
          }
        };
        const backgroundColor = props.backgroundColor as string | undefined;
        const foregroundColor = props.foregroundColor as string | undefined;
        const cornerRadius = props.cornerRadius as number | undefined;
        const width = props.width as string | number | undefined;
        return (
          <button
            onClick={handleClick}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            style={{
              backgroundColor,
              color: foregroundColor,
              borderRadius: cornerRadius ? `${cornerRadius}px` : undefined,
              ...(width ? { width } : null),
              ...paddingStyle,
            }}
          >
            {(props.label as string) || "Button"}
          </button>
        );
      }

      case "tile": {
        const isClickable = Boolean(handlers.tap && onInvokeCallback);
        const handleClick = () => {
          if (handlers.tap && onInvokeCallback) {
            onInvokeCallback(handlers.tap, []);
          }
        };

        const title = (props as any).title as string | undefined;
        const value = (props as any).value as string | undefined;
        const subtitle = (props as any).subtitle as string | undefined;
        const disabled = Boolean((props as any).disabled);
        const monospaceValue = Boolean((props as any).monospaceValue);

        const backgroundColor = props.backgroundColor as string | undefined;
        const foregroundColor = props.foregroundColor as string | undefined;
        const cornerRadius = props.cornerRadius as number | undefined;

        const baseClass =
          "flex w-full flex-col items-start rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-left transition-colors";
        const hoverClass = isClickable && !disabled ? "hover:border-slate-600" : "";

        const Element: any = isClickable ? "button" : "div";

        return (
          <Element
            type={isClickable ? "button" : undefined}
            onClick={isClickable && !disabled ? handleClick : undefined}
            disabled={isClickable ? disabled : undefined}
            className={`${baseClass} ${hoverClass} ${disabled ? "opacity-50" : ""}`}
            style={{
              backgroundColor,
              color: foregroundColor,
              borderRadius: cornerRadius ? `${cornerRadius}px` : undefined,
              ...paddingStyle,
            }}
          >
            {title ? <span className="text-[10px] uppercase text-slate-500">{title}</span> : null}
            {value != null ? (
              <span className={`${monospaceValue ? "font-mono" : ""} text-sm text-slate-200`}>{value}</span>
            ) : null}
            {subtitle ? <span className="mt-0.5 text-[11px] text-slate-500">{subtitle}</span> : null}
          </Element>
        );
      }

      case "card": {
        const title = (props as any).title as string | undefined;
        const subtitle = (props as any).subtitle as string | undefined;
        const spacing = (props.spacing as number) || 12;
        const padding = (props.padding as number) || 16;

        return (
          <div
            className="w-full rounded-lg border border-slate-800 bg-slate-900/60"
            style={{ padding: `${padding}px`, ...paddingStyle }}
          >
            {title ? (
              <div className="mb-3">
                <div className="text-sm font-semibold text-slate-200">{title}</div>
                {subtitle ? <div className="text-xs text-slate-400">{subtitle}</div> : null}
              </div>
            ) : null}
            <div className="flex flex-col" style={{ gap: `${spacing}px` }}>
              {children.map((child, index) => (
                <div key={index}>{renderNode(child)}</div>
              ))}
            </div>
          </div>
        );
      }

      case "text":
        return (
          <div
            className={`text-slate-200 ${resolveFontClass()}`}
            style={{
              color: (props.foregroundColor as string | undefined) ?? undefined,
              backgroundColor: props.backgroundColor as string | undefined,
              borderRadius: typeof props.cornerRadius === "number" ? `${props.cornerRadius}px` : undefined,
              fontSize: typeof (props as any).fontSize === "number" ? `${(props as any).fontSize}px` : undefined,
              ...paddingStyle,
            }}
          >
            {(props.text as string) || ""}
          </div>
        );

      case "slider": {
        const min = (props.min as number) || 0;
        const max = (props.max as number) || 100;
        const value = inputValues[nodeId] !== undefined ? inputValues[nodeId] : ((props.value as number) || 0);
        const step = (props.step as number) || 1;

        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
          const newValue = parseFloat(event.target.value);
          setInputValues((prev) => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        const handleCommit = (event: React.SyntheticEvent<HTMLInputElement>) => {
          if (!handlers.submit || !onInvokeCallback) {
            return;
          }
          const newValue = parseFloat(event.currentTarget.value);
          onInvokeCallback(handlers.submit, [newValue]);
        };

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={handleChange}
              onMouseUp={handleCommit}
              onTouchEnd={handleCommit}
              className="w-full accent-blue-600"
            />
            <div className="text-slate-400 text-xs">{value}</div>
          </div>
        );
      }

      case "textField": {
        const value = inputValues[nodeId] !== undefined ? inputValues[nodeId] : ((props.value as string) || "");
        const placeholder = (props.placeholder as string) || "";

        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
          const newValue = event.target.value;
          setInputValues((prev) => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        const handleSubmit = (event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter" && handlers.submit && onInvokeCallback) {
            onInvokeCallback(handlers.submit, [value]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <input
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              onKeyDown={handleSubmit}
              className="w-full px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
        );
      }

      case "textEditor": {
        const value = inputValues[nodeId] !== undefined ? inputValues[nodeId] : ((props.value as string) || "");
        const placeholder = (props.placeholder as string) || "";
        const rows = (props.rows as number) || 4;

        const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          const newValue = event.target.value;
          setInputValues((prev) => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <textarea
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              rows={rows}
              className="w-full px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
            />
          </div>
        );
      }

      case "logViewer":
        {
          const rawText = (props as any).text;
          const rawLines = (props as any).lines;
          const text =
            typeof rawText === "string"
              ? rawText
              : Array.isArray(rawLines)
                ? rawLines.map((v: unknown) => String(v)).join("\n")
                : "";
        return (
          <div className="w-full rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-200">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400">LOG</div>
            <div className="max-h-48 overflow-y-auto space-y-1 font-mono">
              {text.length === 0 ? (
                <div className="text-slate-500">No output yet.</div>
              ) : (
                <pre className="whitespace-pre-wrap break-words">{text}</pre>
              )}
            </div>
          </div>
        );
        }

      case "scroll": {
        const height = props.height as string | number | undefined;
        return (
          <div
            className="overflow-y-auto"
            style={{ ...(height != null ? { maxHeight: height } : null), ...paddingStyle }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case "spacer": {
        const height = props.height as number | undefined;
        return <div style={{ height: height ?? 12 }} />;
      }

      case "divider":
        return <div className="h-px w-full bg-slate-800" />;

      case "progress": {
        const value = Number(props.value ?? 0);
        const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
        return (
          <div className="w-full rounded-full bg-slate-800" style={{ height: 8 }}>
            <div className="rounded-full bg-sky-500" style={{ width: `${clamped * 100}%`, height: "100%" }} />
          </div>
        );
      }

      case "picker": {
        const options = Array.isArray(props.options) ? (props.options as unknown[]) : [];
        const resolvedOptions = options
          .map((entry) => {
            if (typeof entry === "string") return { label: entry, value: entry };
            if (entry && typeof entry === "object") {
              const raw = entry as { label?: unknown; value?: unknown };
              if (typeof raw.value === "string" && typeof raw.label === "string") return { label: raw.label, value: raw.value };
              if (typeof raw.value === "string") return { label: raw.value, value: raw.value };
            }
            return null;
          })
          .filter(Boolean) as Array<{ label: string; value: string }>;

        const value =
          inputValues[nodeId] !== undefined
            ? inputValues[nodeId]
            : (((props as any).selected as string | undefined) ?? ((props.value as string) || ""));

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <select
              value={value}
              onChange={(event) => {
                const next = event.target.value;
                setInputValues((prev) => ({ ...prev, [nodeId]: next }));
                if (handlers.change && onInvokeCallback) {
                  onInvokeCallback(handlers.change, [next]);
                }
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {resolvedOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      }

      case "toggle": {
        const label = (props as any).label as string | undefined;
        const disabled = Boolean((props as any).disabled);
        const value =
          inputValues[nodeId] !== undefined ? Boolean(inputValues[nodeId]) : Boolean((props as any).value ?? (props as any).selected);

        return (
          <label className={`flex items-center gap-3 ${disabled ? "opacity-60" : ""}`}>
            <input
              type="checkbox"
              checked={value}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.checked;
                setInputValues((prev) => ({ ...prev, [nodeId]: next }));
                if (handlers.change && onInvokeCallback) {
                  onInvokeCallback(handlers.change, [next]);
                }
              }}
              className="h-4 w-4 accent-blue-600"
            />
            {label ? <span className="text-sm text-slate-200">{label}</span> : null}
          </label>
        );
      }

      case "plot": {
        return <ScriptPlot node={node} onInvokeCallback={onInvokeCallback} />;
      }

      case "modal": {
        const open = (props as any).open;
        const isOpen = typeof open === "boolean" ? open : true;
        if (!isOpen) return null;
        const title = (props as any).title as string | undefined;
        const subtitle = (props as any).subtitle as string | undefined;
        const canClose = Boolean(handlers.close && onInvokeCallback);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
            <div className="w-full max-w-xl rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
              {(title || subtitle || canClose) && (
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    {title ? <div className="text-lg font-medium text-slate-100">{title}</div> : null}
                    {subtitle ? <div className="text-xs text-slate-400">{subtitle}</div> : null}
                  </div>
                  {canClose ? (
                    <button
                      className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
                      onClick={() => onInvokeCallback?.(handlers.close, [])}
                    >
                      Close
                    </button>
                  ) : null}
                </div>
              )}
              <div className="flex flex-col gap-3">
                {children.map((child, index) => (
                  <div key={index}>{renderNode(child)}</div>
                ))}
              </div>
            </div>
          </div>
        );
      }

      case "grid": {
        const columns = Math.max(1, Number(props.columns ?? 2) || 2);
        const minColumnWidth = (props as any).minColumnWidth as number | undefined;
        const spacing = (props.spacing as number) || 8;
        const template =
          typeof minColumnWidth === "number" && Number.isFinite(minColumnWidth) && minColumnWidth > 0
            ? `repeat(auto-fit, minmax(${Math.floor(minColumnWidth)}px, 1fr))`
            : `repeat(${columns}, minmax(0, 1fr))`;
        return (
          <div className="grid w-full" style={{ gridTemplateColumns: template, gap: spacing }}>
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      default:
        return (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            Unsupported node type: {(node as any).type}
          </div>
        );
    }
  };

  return <div className="w-full">{renderNode(tree)}</div>;
}
