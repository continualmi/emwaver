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

  return s;
}

function clamp(n: number, lo: number, hi: number) {
  if (!isFinite(n)) return lo;
  if (!isFinite(lo) || !isFinite(hi)) return n;
  return Math.max(lo, Math.min(hi, n));
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
      return (
        <div
          style={{ display: "flex", flexDirection: "column", gap, ...styleFromProps(props), maxHeight: px(props.maxHeight ?? 420), overflow: "auto" }}
          className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.20)]"
        >
          {children.map((c, i) => (
            <React.Fragment key={a.getKey(c, i)}>{renderNode(c, a, i)}</React.Fragment>
          ))}
        </div>
      );
    }

    case "tile":
    case "card": {
      const gap = px(props.spacing ?? 12) ?? "12px";
      return (
        <div
          style={{ display: "flex", flexDirection: "column", gap, ...styleFromProps(props) }}
          className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)]"
        >
          {children.map((c, i) => (
            <React.Fragment key={a.getKey(c, i)}>{renderNode(c, a, i)}</React.Fragment>
          ))}
        </div>
      );
    }

    case "grid": {
      const cols = Number(props.columns ?? 2);
      const gap = px(props.spacing ?? 12) ?? "12px";
      return (
        <div
          style={{
            ...styleFromProps(props),
            display: "grid",
            gridTemplateColumns: `repeat(${isFinite(cols) && cols > 0 ? cols : 2}, minmax(0, 1fr))`,
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
