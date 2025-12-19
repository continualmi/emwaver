/*
 * EMWaver Desktop App
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { DeviceProvider } from "./utils/DeviceContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

if (typeof window !== "undefined") {
  const storedTheme = window.localStorage.getItem("emwaver.theme");
  const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
  document.documentElement.classList.add(`theme-${theme}`);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DeviceProvider>
        <App />
      </DeviceProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
