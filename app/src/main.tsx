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

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { DeviceProvider } from "./utils/DeviceContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppDialogProvider } from "./utils/AppDialogContext";

if (typeof window !== "undefined") {
  window.__emwaverSplash?.setProgress?.(25);
  const storedTheme = window.localStorage.getItem("emwaver.theme");
  const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
  document.documentElement.classList.add(`theme-${theme}`);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DeviceProvider>
        <AppDialogProvider>
          <App />
        </AppDialogProvider>
      </DeviceProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

if (typeof window !== "undefined") {
  window.requestAnimationFrame(() => {
    window.__emwaverSplash?.setProgress?.(55);
    window.dispatchEvent(new Event("emwaver:react-mounted"));
  });
}
