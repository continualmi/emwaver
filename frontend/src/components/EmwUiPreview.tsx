"use client";

import type { EmwUiNode } from "@/lib/emwUiRuntime";

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

  // Some scripts might use width/height.
  if (p.width !== undefined) s.width = px(p.width);
  if (p.height !== undefined) s.height = px(p.height);

  return s;
}

export function EmwUiPreview({ root }: { root: EmwUiNode }) {
  return <div className="space-y-2">{renderNode(root)}</div>;
}

function renderNode(n: EmwUiNode): React.ReactNode {
  const props = n.props || {};

  switch (n.type) {
    case "column":
      return (
        <div
          style={styleFromProps(props)}
          className="flex flex-col rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)]"
        >
          {(n.children || []).map((c, i) => (
            <div key={i}>{renderNode(c)}</div>
          ))}
        </div>
      );

    case "row":
      return (
        <div
          style={styleFromProps(props)}
          className="flex flex-row items-center rounded-xl border border-[color:var(--line)] bg-[rgba(2,4,10,0.35)]"
        >
          {(n.children || []).map((c, i) => (
            <div key={i}>{renderNode(c)}</div>
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
