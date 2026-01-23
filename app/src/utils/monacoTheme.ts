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

const EMWAVER_DARK_THEME = "emwaver-dark";

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
      // Match app dark base surface.
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

  themesRegistered = true;
}

export function getEmwaverMonacoTheme(): string {
  return EMWAVER_DARK_THEME;
}
