"use client";

import React from "react";
import type { RemoteUiNode } from "@/lib/remoteSessions";

function px(n: any): string | undefined {
  if (typeof n === "number") return `${n}px`;
  return undefined;
}

function styleFromProps(props: Record<string, any> | undefined): React.CSSProperties {
  const p = props || {};
  const s: React.CSSProperties = {};

  if (p.padding !== undefined) s.padding = px(p.padding);
  if (p.spacing !== undefined) s.gap = px(p.spacing);

  if (p.backgroundColor) s.backgroundColor = p.backgroundColor;
  if (p.foregroundColor) s.color = p.foregroundColor;

  if (p.width !== undefined) s.width = px(p.width);
  if (p.height !== undefined) s.height = px(p.height);

  return s;
}

export function RemoteEmwUi({ root, onEvent }: { root: RemoteUiNode; onEvent: (targetId: string, name: string, payload: any) => void }) {
  return <div className="space-y-2">{renderNode(root, onEvent)}</div>;
}

function hasHandler(n: RemoteUiNode, ev: string): boolean {
  return !!(n.handlers && typeof n.handlers[ev] === "string" && n.handlers[ev]);
}

function renderNode(n: RemoteUiNode | null | undefined, onEvent: (targetId: string, name: string, payload: any) => void): React.ReactNode {
  if (!n) return null;
  const props = n.props || {};

  switch (n.type) {
    case "column":
      return (
        <div
          style={styleFromProps(props)}
          className="flex flex-col rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)]"
        >
          {(n.children || []).map((c) => (
            <div key={c.id}>{renderNode(c, onEvent)}</div>
          ))}
        </div>
      );

    case "row":
      return (
        <div
          style={styleFromProps(props)}
          className="flex flex-row items-center rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)]"
        >
          {(n.children || []).map((c) => (
            <div key={c.id}>{renderNode(c, onEvent)}</div>
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
      const enabled = hasHandler(n, "tap");
      return (
        <button
          type="button"
          disabled={!enabled}
          onClick={() => onEvent(n.id, "tap", {})}
          style={styleFromProps(props)}
          className="inline-flex items-center justify-center rounded-xl bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:var(--paper)] disabled:opacity-40"
        >
          {String(props.label ?? props.text ?? "Button")}
        </button>
      );
    }

    case "picker": {
      const enabled = hasHandler(n, "select") || hasHandler(n, "change");
      const options = Array.isArray(props.options) ? props.options : [];
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{props.id ?? "Picker"}</div>
          <select
            disabled={!enabled}
            value={String(props.selected ?? "")}
            className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-2)] p-2 text-sm text-[color:var(--ink)] disabled:opacity-50"
            onChange={(e) => onEvent(n.id, hasHandler(n, "select") ? "select" : "change", { value: e.target.value })}
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
      // Some scripts (e.g. blink.emw) use onSubmit for sliders instead of onChange.
      // Support both so the control isn’t locked.
      const hasChange = hasHandler(n, "change");
      const hasSubmit = hasHandler(n, "submit");
      const enabled = hasChange || hasSubmit;

      const min = Number(props.min ?? 0);
      const max = Number(props.max ?? 100);
      const step = Number(props.step ?? 1);
      const value = Number(props.value ?? min);

      const sendName = hasChange ? "change" : hasSubmit ? "submit" : "change";

      return (
        <div style={styleFromProps(props)} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{props.id ?? "Slider"}</div>
            <div className="text-xs text-[color:var(--ink-dim)]">{String(value)}</div>
          </div>
          <input
            type="range"
            disabled={!enabled}
            min={min}
            max={max}
            step={step}
            value={value}
            className="w-full disabled:opacity-50"
            onChange={(e) => onEvent(n.id, sendName, { value: Number(e.target.value) })}
            onMouseUp={(e) => {
              if (hasSubmit) onEvent(n.id, "submit", { value: Number((e.target as HTMLInputElement).value) });
            }}
            onTouchEnd={(e) => {
              if (hasSubmit) onEvent(n.id, "submit", { value: Number((e.target as HTMLInputElement).value) });
            }}
          />
        </div>
      );
    }

    case "textField": {
      const enabled = hasHandler(n, "change") || hasHandler(n, "submit");
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
            onChange={(e) => hasHandler(n, "change") && onEvent(n.id, "change", { value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hasHandler(n, "submit")) {
                onEvent(n.id, "submit", { value: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>
      );
    }

    case "textEditor": {
      const enabled = hasHandler(n, "change") || hasHandler(n, "submit");
      const val = String(props.value ?? props.text ?? "");
      return (
        <div style={styleFromProps(props)} className="space-y-2">
          {props.label ? <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{String(props.label)}</div> : null}
          <textarea
            disabled={!enabled}
            value={val}
            className="h-40 w-full rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.65)] p-2 font-mono text-xs text-[color:var(--ink)] disabled:opacity-50"
            onChange={(e) => hasHandler(n, "change") && onEvent(n.id, "change", { value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && hasHandler(n, "submit")) {
                onEvent(n.id, "submit", { value: (e.target as HTMLTextAreaElement).value });
              }
            }}
          />
        </div>
      );
    }

    case "scroll":
      return (
        <div
          style={{ ...styleFromProps(props), maxHeight: px(props.maxHeight ?? 420), overflow: "auto" }}
          className="rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.20)] p-2"
        >
          {(n.children || []).map((c) => (
            <div key={c.id}>{renderNode(c, onEvent)}</div>
          ))}
        </div>
      );

    case "tile":
    case "card":
      return (
        <div style={styleFromProps(props)} className="rounded-2xl border border-[color:var(--line)] bg-[rgba(255,255,255,0.03)] p-4">
          {(n.children || []).map((c) => (
            <div key={c.id}>{renderNode(c, onEvent)}</div>
          ))}
        </div>
      );

    case "grid": {
      const cols = Number(props.columns ?? 2);
      const gap = px(props.spacing ?? 12) ?? "12px";
      return (
        <div style={{ ...styleFromProps(props), display: "grid", gridTemplateColumns: `repeat(${isFinite(cols) && cols > 0 ? cols : 2}, minmax(0, 1fr))`, gap }}>
          {(n.children || []).map((c) => (
            <div key={c.id}>{renderNode(c, onEvent)}</div>
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
          Unsupported node: <span className="font-mono text-[color:var(--ink)]">{n.type}</span>
        </div>
      );
  }
}
