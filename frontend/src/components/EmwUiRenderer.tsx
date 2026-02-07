"use client";

import React from "react";

export type UiNodeLike = {
  type: string;
  props?: Record<string, any>;
  children?: any[];
};

type RendererAdapter<N extends UiNodeLike> = {
  getKey: (n: N, index: number) => string;
  getType: (n: N) => string;
  getProps: (n: N) => Record<string, any>;
  getChildren: (n: N) => N[];
  isEnabled: (n: N, eventName: string) => boolean;
  onEvent: (n: N, eventName: string, payload: any) => void;
};

function px(n: any): string | undefined {
  if (typeof n === "number" && isFinite(n)) return `${n}px`;
  return undefined;
}

function paddingToCss(padding: any): React.CSSProperties {
  // Supports:
  // - number: uniform padding
  // - object: { top, bottom, leading, trailing } or { top, bottom, left, right }
  if (typeof padding === "number") return { padding: px(padding) };
  if (!padding || typeof padding !== "object") return {};

  const top = px(padding.top);
  const bottom = px(padding.bottom);
  const left = px(padding.leading ?? padding.left);
  const right = px(padding.trailing ?? padding.right);

  const out: React.CSSProperties = {};
  if (top) out.paddingTop = top;
  if (bottom) out.paddingBottom = bottom;
  if (left) out.paddingLeft = left;
  if (right) out.paddingRight = right;
  return out;
}

function styleFromProps(props: Record<string, any> | undefined): React.CSSProperties {
  const p = props || {};
  const s: React.CSSProperties = {};

  if (p.padding !== undefined) Object.assign(s, paddingToCss(p.padding));
  if (p.spacing !== undefined) s.gap = px(p.spacing);

  if (p.backgroundColor) s.backgroundColor = p.backgroundColor;
  if (p.foregroundColor) s.color = p.foregroundColor;

  if (p.width !== undefined) s.width = px(p.width);
  if (p.height !== undefined) s.height = px(p.height);

  if (p.minWidth !== undefined) s.minWidth = px(p.minWidth);
  if (p.maxWidth !== undefined) s.maxWidth = px(p.maxWidth);
  if (p.minHeight !== undefined) s.minHeight = px(p.minHeight);
  if (p.maxHeight !== undefined) s.maxHeight = px(p.maxHeight);

  // Common script layout hint: fillsWidth=true means stretch.
  if (p.fillsWidth === true) {
    s.maxWidth = "100%";
    s.width = s.width ?? "100%";
  }

  if (p.cornerRadius !== undefined && typeof p.cornerRadius === "number" && isFinite(p.cornerRadius)) {
    s.borderRadius = `${p.cornerRadius}px`;
  }

  return s;
}

function clamp(n: number, lo: number, hi: number) {
  if (!isFinite(n)) return lo;
  if (!isFinite(lo) || !isFinite(hi)) return n;
  return Math.max(lo, Math.min(hi, n));
}

function PlotNode<N extends UiNodeLike>({ n, a }: { n: N; a: RendererAdapter<N> }) {
  const props = a.getProps(n) || {};
  const plot = (props.__plotData as any) || null;

  const yMin = Number(props.yMin ?? -128);
  const yMax = Number(props.yMax ?? 384);

  const xMin = Number(plot?.xMin ?? props.xMin ?? 0);
  const xMax = Number(plot?.xMax ?? props.xMax ?? 1);

  const dataX: number[] = Array.isArray(plot?.dataX) ? plot.dataX.map((v: any) => Number(v)).filter((v: number) => isFinite(v)) : [];
  const dataY: number[] = Array.isArray(plot?.dataY) ? plot.dataY.map((v: any) => Number(v)).filter((v: number) => isFinite(v)) : [];

  const height = typeof props.height === "number" && isFinite(props.height) ? `${props.height}px` : "400px";

  const [view, setView] = React.useState<{ min: number; max: number }>({
    min: isFinite(xMin) ? xMin : 0,
    max: isFinite(xMax) && xMax > xMin ? xMax : (isFinite(xMin) ? xMin + 1 : 1),
  });

  // Keep local view in sync with host responses.
  React.useEffect(() => {
    if (!isFinite(xMin) || !isFinite(xMax) || xMax <= xMin) return;
    setView({ min: xMin, max: xMax });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot?.xMin, plot?.xMax, props.xMin, props.xMax]);

  // Request initial viewport if we don't have any data yet.
  React.useEffect(() => {
    if (dataX.length > 0 && dataY.length > 0) return;
    a.onEvent(n, "viewport", { min: view.min, max: view.max, bins: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingTimer = React.useRef<any>(null);
  function emitViewportSoon(next: { min: number; max: number }) {
    setView(next);
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      a.onEvent(n, "viewport", { min: next.min, max: next.max, bins: 400 });
      pendingTimer.current = null;
    }, 120);
  }

  const ref = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ down: boolean; x0: number; startMin: number; startMax: number }>({
    down: false,
    x0: 0,
    startMin: view.min,
    startMax: view.max,
  });

  function domainSpan(v: { min: number; max: number }) {
    return Math.max(1e-9, v.max - v.min);
  }

  function onWheel(e: React.WheelEvent) {
    // Prevent the parent page/scroll containers from also scrolling.
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = (e.clientX - rect.left) / Math.max(1, rect.width);

    const span = domainSpan(view);
    const dy = Number(e.deltaY);
    if (!isFinite(dy) || dy === 0) return;

    // Match macOS feel: wheel direction should match the native chart.
    // (In practice browsers/devices disagree on deltaY sign, so we use the direction
    // that matches observed behavior in EMWaver's frontend.)
    const z = Math.exp(dy * 0.002);
    const nextSpan = Math.max(1, span * z);
    const anchor = view.min + t * span;
    const nextMin = anchor - t * nextSpan;
    const nextMax = nextMin + nextSpan;

    if (isFinite(nextMin) && isFinite(nextMax) && nextMax > nextMin) {
      emitViewportSoon({ min: nextMin, max: nextMax });
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    drag.current = { down: true, x0: e.clientX, startMin: view.min, startMax: view.max };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drag.current.down) return;
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dxPx = e.clientX - drag.current.x0;
    const span = domainSpan({ min: drag.current.startMin, max: drag.current.startMax });
    const delta = (-dxPx / Math.max(1, rect.width)) * span;
    emitViewportSoon({ min: drag.current.startMin + delta, max: drag.current.startMax + delta });
  }

  function onMouseUp() {
    drag.current.down = false;
  }

  function onTouchStart(e: React.TouchEvent) {
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    drag.current = { down: true, x0: t.clientX, startMin: view.min, startMax: view.max };
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!drag.current.down) return;
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dxPx = t.clientX - drag.current.x0;
    const span = domainSpan({ min: drag.current.startMin, max: drag.current.startMax });
    const delta = (-dxPx / Math.max(1, rect.width)) * span;
    emitViewportSoon({ min: drag.current.startMin + delta, max: drag.current.startMax + delta });
  }

  function onTouchEnd(e: React.TouchEvent) {
    e.stopPropagation();
    drag.current.down = false;
  }

  const w = 1000;
  const h = 200;
  const ptsCount = Math.min(dataX.length, dataY.length);
  const poly: string[] = [];
  for (let i = 0; i < ptsCount; i++) {
    const x = dataX[i];
    const y = dataY[i];
    if (!isFinite(x) || !isFinite(y)) continue;
    const tx = (x - view.min) / domainSpan(view);
    const ty = (y - yMin) / Math.max(1e-9, yMax - yMin);
    const pxX = tx * w;
    const pxY = (1 - ty) * h;
    if (!isFinite(pxX) || !isFinite(pxY)) continue;
    poly.push(`${pxX.toFixed(2)},${pxY.toFixed(2)}`);
  }

  const hasData = poly.length > 1;

  return (
    <div style={{ ...styleFromProps(props) }} className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[color:var(--ink-dim)]">
        <div>{String(props.title ?? props.id ?? "Plot")}</div>
        <div className="font-mono">x [{Math.round(view.min)} .. {Math.round(view.max)}]</div>
      </div>

      <div
        ref={ref}
        style={{ height, width: "100%", maxWidth: "100%", overscrollBehavior: "contain", touchAction: "none" as any, position: "relative" }}
        className="w-full select-none overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)]"
        onWheel={onWheel}
        onWheelCapture={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          style={{ display: "block", overflow: "hidden" }}
          className="h-full w-full"
        >
          {hasData ? (
            <polyline
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={poly.join(" ")}
            />
          ) : (
            <text x="20" y="40" fill="rgba(255,255,255,0.6)" fontSize="24">
              waiting for data…
            </text>
          )}
        </svg>
      </div>

      <div className="mt-2 text-[11px] text-[color:var(--ink-dim)]">
        Drag to pan • Wheel to zoom • Data stays on host (viewport is compressed to ~400 bins)
      </div>
    </div>
  );
}

function SliderNode<N extends UiNodeLike>({ n, a }: { n: N; a: RendererAdapter<N> }) {
  const props = a.getProps(n) || {};

  const hasChange = a.isEnabled(n, "change");
  const hasSubmit = a.isEnabled(n, "submit");
  const enabled = hasChange || hasSubmit;

  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const step = Number(props.step ?? 1);
  const remoteValue = clamp(Number(props.value ?? min), min, max);

  // If submit is supported, we keep local drag state and only send when released.
  const [localValue, setLocalValue] = React.useState<number>(remoteValue);
  const [isDragging, setIsDragging] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!isDragging) setLocalValue(remoteValue);
  }, [remoteValue, isDragging]);

  const displayValue = hasSubmit ? localValue : remoteValue;

  return (
    <div style={styleFromProps(props)} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{props.id ?? "Slider"}</div>
        <div className="text-xs text-[color:var(--ink-dim)]">{String(displayValue)}</div>
      </div>
      <input
        type="range"
        disabled={!enabled}
        min={min}
        max={max}
        step={step}
        value={displayValue}
        className="w-full disabled:opacity-50"
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={(e) => {
          setIsDragging(false);
          if (hasSubmit) a.onEvent(n, "submit", { value: Number((e.target as HTMLInputElement).value) });
        }}
        onTouchStart={() => setIsDragging(true)}
        onTouchEnd={(e) => {
          setIsDragging(false);
          if (hasSubmit) a.onEvent(n, "submit", { value: Number((e.target as HTMLInputElement).value) });
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (hasSubmit) {
            setLocalValue(v);
            return;
          }
          if (hasChange) a.onEvent(n, "change", { value: v });
        }}
      />
    </div>
  );
}

function renderNode<N extends UiNodeLike>(n: N | null | undefined, a: RendererAdapter<N>, index: number): React.ReactNode {
  if (!n) return null;
  const type = a.getType(n);
  const props = a.getProps(n) || {};
  const children = a.getChildren(n) || [];

  switch (type) {
    case "column":
      return (
        <div style={{ display: "flex", flexDirection: "column", ...styleFromProps(props) }}>
          {children.map((c, i) => (
            <React.Fragment key={a.getKey(c, i)}>{renderNode(c, a, i)}</React.Fragment>
          ))}
        </div>
      );

    case "row":
      return (
        <div
          style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", ...styleFromProps(props) }}
        >
          {children.map((c, i) => (
            <React.Fragment key={a.getKey(c, i)}>{renderNode(c, a, i)}</React.Fragment>
          ))}
        </div>
      );

    case "text":
      return (
        <div style={styleFromProps(props)} className="text-sm text-[color:var(--ink)]">
          {String(props.text ?? "")}
        </div>
      );

    case "button": {
      const enabled = a.isEnabled(n, "tap");
      return (
        <button
          type="button"
          disabled={!enabled}
          onClick={() => enabled && a.onEvent(n, "tap", {})}
          style={styleFromProps(props)}
          className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] disabled:opacity-40"
        >
          {String(props.label ?? props.text ?? "Button")}
        </button>
      );
    }

    case "picker": {
      const enabled = a.isEnabled(n, "select") || a.isEnabled(n, "change");
      const options = Array.isArray(props.options) ? props.options : [];
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{props.id ?? "Picker"}</div>
          <select
            disabled={!enabled}
            value={String(props.selected ?? "")}
            className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-sm text-[color:var(--ink)] disabled:opacity-50"
            onChange={(e) => {
              const ev = a.isEnabled(n, "select") ? "select" : "change";
              a.onEvent(n, ev, { value: e.target.value });
            }}
          >
            {options.map((o: any, i: number) => (
              <option key={i} value={String(o?.value ?? "")}
                >{String(o?.label ?? o?.value ?? "")}</option>
            ))}
          </select>
        </div>
      );
    }

    case "slider":
      return <SliderNode n={n} a={a} />;

    case "textField": {
      const enabled = a.isEnabled(n, "change") || a.isEnabled(n, "submit");
      const val = String(props.value ?? props.text ?? "");
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          {props.label ? <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{String(props.label)}</div> : null}
          <input
            type="text"
            disabled={!enabled}
            value={val}
            placeholder={props.placeholder ? String(props.placeholder) : ""}
            className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-sm text-[color:var(--ink)] disabled:opacity-50"
            onChange={(e) => a.isEnabled(n, "change") && a.onEvent(n, "change", { value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && a.isEnabled(n, "submit")) {
                a.onEvent(n, "submit", { value: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>
      );
    }

    case "textEditor": {
      const enabled = a.isEnabled(n, "change") || a.isEnabled(n, "submit");
      const val = String(props.value ?? props.text ?? "");
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          {props.label ? <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{String(props.label)}</div> : null}
          <textarea
            disabled={!enabled}
            value={val}
            className="h-40 w-full rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-2 font-mono text-xs text-[color:var(--ink)] disabled:opacity-50"
            onChange={(e) => a.isEnabled(n, "change") && a.onEvent(n, "change", { value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && a.isEnabled(n, "submit")) {
                a.onEvent(n, "submit", { value: (e.target as HTMLTextAreaElement).value });
              }
            }}
          />
        </div>
      );
    }

    case "scroll": {
      const gap = px(props.spacing ?? 12) ?? "12px";
      const maxH = px(props.maxHeight);
      return (
        <div
          style={{ display: "flex", flexDirection: "column", gap, ...styleFromProps(props), ...(maxH ? { maxHeight: maxH, overflow: "auto" } : {}) }}
          className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.20)]"
        >
          {children.map((c, i) => (
            <React.Fragment key={a.getKey(c, i)}>{renderNode(c, a, i)}</React.Fragment>
          ))}
        </div>
      );
    }

    case "tile": {
      const enabled = a.isEnabled(n, "tap") && !props.disabled;
      const title = props.title ?? props.label;
      const value = props.value;
      const mono = !!props.monospaceValue;
      const pad = props.padding === undefined ? 12 : undefined;

      return (
        <button
          type="button"
          disabled={!enabled}
          onClick={() => enabled && a.onEvent(n, "tap", {})}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            textAlign: "left",
            width: "100%",
            ...(pad !== undefined ? { padding: px(pad) } : {}),
            ...styleFromProps(props),
          }}
          className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] disabled:opacity-40"
        >
          {title !== undefined ? <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{String(title)}</div> : null}
          <div className={mono ? "font-mono text-sm text-[color:var(--ink)]" : "text-sm text-[color:var(--ink)]"}>{String(value ?? "")}</div>
        </button>
      );
    }

    case "card": {
      const gap = px(props.spacing ?? 12) ?? "12px";
      const pad = props.padding === undefined ? 16 : undefined;
      const title = props.title;
      const subtitle = props.subtitle;

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap,
            ...(pad !== undefined ? { padding: px(pad) } : {}),
            ...styleFromProps(props),
          }}
          className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] overflow-hidden"
        >
          {title || subtitle ? (
            <div className="space-y-1">
              {title ? <div className="text-sm font-semibold text-[color:var(--ink)]">{String(title)}</div> : null}
              {subtitle ? <div className="text-xs text-[color:var(--ink-dim)]">{String(subtitle)}</div> : null}
            </div>
          ) : null}

          {children.map((c, i) => (
            <React.Fragment key={a.getKey(c, i)}>{renderNode(c, a, i)}</React.Fragment>
          ))}
        </div>
      );
    }

    case "grid": {
      const gap = px(props.spacing ?? 12) ?? "12px";
      const minCol = px(props.minColumnWidth);
      const cols = Number(props.columns ?? 0);

      const gridTemplateColumns = minCol
        ? `repeat(auto-fit, minmax(${minCol}, 1fr))`
        : `repeat(${isFinite(cols) && cols > 0 ? cols : 2}, minmax(0, 1fr))`;

      return (
        <div
          style={{
            ...styleFromProps(props),
            display: "grid",
            gridTemplateColumns,
            gap,
          }}
        >
          {children.map((c, i) => (
            <React.Fragment key={a.getKey(c, i)}>{renderNode(c, a, i)}</React.Fragment>
          ))}
        </div>
      );
    }

    case "logViewer": {
      const text = String(props.text ?? props.value ?? "");
      return (
        <pre
          style={styleFromProps(props)}
          className="whitespace-pre-wrap rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-3 font-mono text-xs text-[color:var(--ink)]"
        >
          {text}
        </pre>
      );
    }

    case "divider":
      return <div className="h-px w-full bg-[color:var(--line)]" />;

    case "spacer":
      return <div style={{ height: px(props.height ?? 12) }} />;

    case "progress": {
      const value = Number(props.value ?? 0);
      const max = Number(props.total ?? props.max ?? 100);
      const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
            <div className="h-full bg-[color:var(--aqua)]" style={{ width: `${pct * 100}%` }} />
          </div>
          <div className="text-xs text-[color:var(--ink-dim)]">{Math.round(pct * 100)}%</div>
        </div>
      );
    }

    case "plot":
      return <PlotNode n={n} a={a} />;

    default:
      return (
        <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-2 text-xs text-[color:var(--ink-dim)]">
          Unsupported node: <span className="font-mono text-[color:var(--ink)]">{type}</span>
        </div>
      );
  }
}

export function EmwUiRenderer<N extends UiNodeLike>({ root, adapter }: { root: N; adapter: RendererAdapter<N> }) {
  return <div className="space-y-2">{renderNode(root, adapter, 0)}</div>;
}
