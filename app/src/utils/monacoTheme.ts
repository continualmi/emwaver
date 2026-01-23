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

import type * as Monaco from "monaco-editor";

export type MonacoThemeMode = "dark" | "light";

const EMWAVER_DARK_THEME = "emwaver-dark";
const EMWAVER_LIGHT_THEME = "emwaver-light";

let themesRegistered = false;

export function ensureEmwaverMonacoThemes(monaco: typeof Monaco): void {
  if (themesRegistered) {
    return;
  }

  monaco.editor.defineTheme(EMWAVER_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      // Slightly lifted dark background for readability.
      "editor.background": "#0F172A",
      "editor.foreground": "#F1F5F9",
      "editorLineNumber.foreground": "#94A3B8",
      "editorLineNumber.activeForeground": "#CBD5E1",
      "editorCursor.foreground": "#38BDF8",
      "editor.selectionBackground": "#47556999",
      "editor.inactiveSelectionBackground": "#33415580",
      "editor.lineHighlightBackground": "#111C32",
      "editorWhitespace.foreground": "#475569",
      "editorIndentGuide.background": "#1E293B",
      "editorIndentGuide.activeBackground": "#334155",
      "editorGutter.background": "#0F172A",
      "editorOverviewRuler.background": "#0F172A",
      "editorWidget.background": "#111C32",
      "editorWidget.border": "#1E293B",
      "editorSuggestWidget.background": "#111C32",
      "editorSuggestWidget.border": "#1E293B",
      "editorSuggestWidget.selectedBackground": "#1E293B",
      "editorHoverWidget.background": "#111C32",
      "editorHoverWidget.border": "#1E293B",
      "diffEditor.insertedTextBackground": "#14532D55",
      "diffEditor.removedTextBackground": "#7F1D1D55",
    },
  });

  monaco.editor.defineTheme(EMWAVER_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#F8FAFC",
      "editor.foreground": "#0F172A",
      "editorLineNumber.foreground": "#94A3B8",
      "editorLineNumber.activeForeground": "#0F172A",
      "editorCursor.foreground": "#0284C7",
      "editor.selectionBackground": "#93C5FD66",
      "editor.inactiveSelectionBackground": "#CBD5E166",
      "editor.lineHighlightBackground": "#E2E8F0",
      "editorWhitespace.foreground": "#CBD5E1",
      "editorIndentGuide.background": "#E2E8F0",
      "editorIndentGuide.activeBackground": "#CBD5E1",
      "editorGutter.background": "#F8FAFC",
      "editorOverviewRuler.background": "#F8FAFC",
      "editorWidget.background": "#FFFFFF",
      "editorWidget.border": "#CBD5E1",
      "editorSuggestWidget.background": "#FFFFFF",
      "editorSuggestWidget.border": "#CBD5E1",
      "editorSuggestWidget.selectedBackground": "#E2E8F0",
      "editorHoverWidget.background": "#FFFFFF",
      "editorHoverWidget.border": "#CBD5E1",
      "diffEditor.insertedTextBackground": "#86EFAC66",
      "diffEditor.removedTextBackground": "#FCA5A566",
    },
  });

  themesRegistered = true;
}

export function getEmwaverMonacoTheme(mode: MonacoThemeMode): string {
  return mode === "light" ? EMWAVER_LIGHT_THEME : EMWAVER_DARK_THEME;
}
