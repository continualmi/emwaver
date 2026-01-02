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

import * as os from "node:os";
import * as path from "node:path";

export function expandCliPath(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return value;

  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));

  if (value.includes("${userHome}")) {
    return value.replaceAll("${userHome}", os.homedir());
  }

  return value;
}

