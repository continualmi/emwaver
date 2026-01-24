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

import { useState } from "react";
import type { ReactNode } from "react";
import type { ScriptTree } from "../../utils/ScriptEngine";

export default function ScriptUIRenderer({
  tree,
  consoleOutput = [],
  onInvokeCallback,
}: {
  tree: ScriptTree;
  consoleOutput?: string[];
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

    switch (node.type) {
      case "column": {
        const spacing = (props.spacing as number) || 12;
        const padding = (props.padding as number) || 0;
        return (
          <div
            className="flex flex-col"
            style={{
              gap: `${spacing}px`,
              padding: `${padding}px`,
              width: "100%",
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
        return (
          <div className="flex w-full" style={{ gap: `${spacing}px` }}>
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

      case "text":
        return (
          <div
            className="text-slate-200 text-sm"
            style={{
              color: (props.foregroundColor as string | undefined) ?? undefined,
              backgroundColor: props.backgroundColor as string | undefined,
              borderRadius: typeof props.cornerRadius === "number" ? `${props.cornerRadius}px` : undefined,
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
        return (
          <div className="w-full rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-200">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400">LOG</div>
            <div className="max-h-48 overflow-y-auto space-y-1 font-mono">
              {consoleOutput.length === 0 ? (
                <div className="text-slate-500">No output yet.</div>
              ) : (
                consoleOutput.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-words">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case "scroll": {
        const height = props.height as string | number | undefined;
        return (
          <div className="overflow-y-auto" style={{ maxHeight: height ?? 360, ...paddingStyle }}>
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

      case "grid": {
        const columns = Math.max(1, Number(props.columns ?? 2) || 2);
        const spacing = (props.spacing as number) || 8;
        return (
          <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: spacing }}>
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
