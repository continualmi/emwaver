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

import type { DirectoryChildEntry } from "./workspaceTypes";

export const SCRIPT_ASSET_ROOT = "/default-scripts";
export const SCRIPT_BOOTSTRAP_FILENAME = "script_bootstrap.js";
export const SCRIPT_EXAMPLE_SCRIPTS = [
  "hello.emw",
  "blink.emw",
  "adc.emw",
  "pwm.emw",
  "cc1101.emw",
  "gpio.emw",
  "i2c.emw",
  "sampler.emw",
  "uart.emw",
];

export const SCRIPT_ASSET_SCRIPTS = SCRIPT_EXAMPLE_SCRIPTS;

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function extension(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function languageForPath(path: string): string {
  const ext = extension(path);
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "emw") return "javascript";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "rs") return "rust";
  if (ext === "c" || ext === "h") return "c";
  if (ext === "cpp" || ext === "hpp" || ext === "cc") return "cpp";
  if (ext === "py") return "python";
  if (ext === "toml") return "toml";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "sh") return "shell";
  return "plaintext";
}

export function isScriptScriptPath(path: string): boolean {
  const ext = extension(path);
  return ext === "emw";
}

export function isScriptAssetPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized === SCRIPT_ASSET_ROOT || normalized.startsWith(`${SCRIPT_ASSET_ROOT}/`);
}

export function scriptAssetPath(filename: string): string {
  return `${SCRIPT_ASSET_ROOT}/${filename}`;
}

export function defaultIgnoredName(name: string): boolean {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build" ||
    name === "target" ||
    name === ".next" ||
    name === ".emwaver"
  );
}

export async function readScriptAssetScript(filename: string): Promise<string> {
  try {
    const response = await fetch(`${SCRIPT_ASSET_ROOT}/${filename}`);
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  }
}

export function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

export function timestampLabel(date: Date): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function iconLabelForPath(path: string): { kind: "emw" | "text"; label: string; accentClass: string } {
  const ext = extension(path);
  if (ext === "emw") return { kind: "emw", label: "EM", accentClass: "" };
  if (ext === "ts" || ext === "tsx") return { kind: "text", label: "TS", accentClass: "text-sky-400" };
  if (ext === "js" || ext === "jsx") return { kind: "text", label: "JS", accentClass: "text-amber-300" };
  if (ext === "json") return { kind: "text", label: "{}", accentClass: "text-yellow-200" };
  if (ext === "md") return { kind: "text", label: "M", accentClass: "text-slate-300" };
  if (ext === "rs") return { kind: "text", label: "RS", accentClass: "text-orange-300" };
  if (ext === "c") return { kind: "text", label: "C", accentClass: "text-sky-300" };
  if (ext === "h") return { kind: "text", label: "H", accentClass: "text-pink-300" };
  if (ext === "toml") return { kind: "text", label: "T", accentClass: "text-slate-300" };
  if (ext === "yml" || ext === "yaml") return { kind: "text", label: "Y", accentClass: "text-emerald-300" };
  if (ext === "sh") return { kind: "text", label: "$", accentClass: "text-emerald-300" };
  return { kind: "text", label: "•", accentClass: "text-slate-400" };
}
