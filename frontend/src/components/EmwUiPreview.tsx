"use client";

import React from "react";
import type { EmwUiNode } from "@/lib/emwUiRuntime";

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

  // Some scripts might use width/height.
  if (p.width !== undefined) s.width = px(p.width);
  if (p.height !== undefined) s.height = px(p.height);

  return s;
}

export function EmwUiPreview({ root }: { root: EmwUiNode }) {
  return <div className="space-y-2">{renderNode(root)}</div>;
}

function renderNode(n: EmwUiNode | null | undefined): React.ReactNode {
  if (!n) return null;
  const props = n.props || {};

  switch (n.type) {
    case "column":
      return (
        <div style={{ display: "flex", flexDirection: "column", ...styleFromProps(props) }}>
          {(n.children || []).map((c, i) => (
            <React.Fragment key={i}>{renderNode(c)}</React.Fragment>
          ))}
        </div>
      );

    case "row":
      return (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", ...styleFromProps(props) }}>
          {(n.children || []).map((c, i) => (
            <React.Fragment key={i}>{renderNode(c)}</React.Fragment>
          ))}
        </div>
      );

    case "text":
      return (
        <div style={styleFromProps(props)} className="text-sm text-[color:var(--ink)]">
          {String(props.text ?? "")}
        </div>
      );

    case "button":
      return (
        <button
          type="button"
          disabled
          title="UI preview only (disabled)"
          style={styleFromProps(props)}
          className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] opacity-80"
        >
          {String(props.label ?? props.text ?? "Button")}
        </button>
      );

    case "picker": {
      const options = Array.isArray(props.options) ? props.options : [];
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{props.id ?? "Picker"}</div>
          <select
            disabled
            value={String(props.selected ?? "")}
            className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-sm text-[color:var(--ink)]"
            onChange={() => {}}
          >
            {options.map((o: any, i: number) => (
              <option key={i} value={String(o?.value ?? "")}
                >{String(o?.label ?? o?.value ?? "")}</option>
            ))}
          </select>
        </div>
      );
    }

    case "slider": {
      const min = Number(props.min ?? 0);
      const max = Number(props.max ?? 100);
      const step = Number(props.step ?? 1);
      const value = Number(props.value ?? min);
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{props.id ?? "Slider"}</div>
            <div className="text-xs text-[color:var(--ink-dim)]">{String(value)}</div>
          </div>
          <input type="range" disabled min={min} max={max} step={step} value={value} className="w-full" onChange={() => {}} />
        </div>
      );
    }

    case "textField": {
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          {props.label ? <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{String(props.label)}</div> : null}
          <input
            type="text"
            disabled
            value={String(props.value ?? props.text ?? "")}
            placeholder={props.placeholder ? String(props.placeholder) : ""}
            className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-sm text-[color:var(--ink)]"
            onChange={() => {}}
          />
        </div>
      );
    }

    case "textEditor": {
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          {props.label ? <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{String(props.label)}</div> : null}
          <textarea
            disabled
            value={String(props.value ?? props.text ?? "")}
            className="h-40 w-full rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-2 font-mono text-xs text-[color:var(--ink)]"
            onChange={() => {}}
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
          {(n.children || []).map((c, i) => (
            <React.Fragment key={i}>{renderNode(c)}</React.Fragment>
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
          {(n.children || []).map((c, i) => (
            <React.Fragment key={i}>{renderNode(c)}</React.Fragment>
          ))}
        </div>
      );
    }

    case "grid": {
      const cols = Number(props.columns ?? 2);
      const gap = px(props.spacing ?? 12) ?? "12px";
      return (
        <div style={{ ...styleFromProps(props), display: "grid", gridTemplateColumns: `repeat(${isFinite(cols) && cols > 0 ? cols : 2}, minmax(0, 1fr))`, gap }}>
          {(n.children || []).map((c, i) => (
            <div key={i}>{renderNode(c)}</div>
          ))}
        </div>
      );
    }

    case "logViewer": {
      const text = String(props.text ?? props.value ?? "");
      return (
        <pre style={styleFromProps(props)} className="whitespace-pre-wrap rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-3 font-mono text-xs text-[color:var(--ink)]">
          {text}
        </pre>
      );
    }

    case "buffer":
    case "plot": {
      return (
        <div style={styleFromProps(props)} className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)] p-3 text-xs text-[color:var(--ink-dim)]">
          {n.type} (preview stub)
        </div>
      );
    }

    case "progress": {
      const value = Number(props.value ?? 0);
      const max = Number(props.max ?? 100);
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

    case "divider":
      return <div className="h-px w-full bg-[color:var(--line)]" />;

    case "spacer":
      return <div style={{ height: px(props.height ?? 12) }} />;

    default:
      return (
        <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-2 text-xs text-[color:var(--ink-dim)]">
          Unsupported node: <span className="font-mono text-[color:var(--ink)]">{n.type}</span>
        </div>
      );
  }
}
