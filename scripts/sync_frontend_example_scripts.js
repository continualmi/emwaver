#!/usr/bin/env node
/*
  Sync frontend bundled example scripts from assets/default-scripts/*.emw.

  Rationale:
  - Source of truth is assets/default-scripts.
  - The web dashboard needs bundled examples at build-time.
  - We generate frontend/src/lib/exampleEmwScripts.ts from the assets files.
*/

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(repoRoot, "assets", "default-scripts");
const outPath = path.join(repoRoot, "frontend", "src", "lib", "exampleEmwScripts.ts");

const allow = [
  "hello.emw",
  "blink.emw",
  "adc.emw",
  "gpio.emw",
  "i2c.emw",
  "pwm.emw",
  "sampler.emw",
  "cc1101.emw",
  "ism.emw",
  "chart.emw",
];

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function stableSort(a, b) {
  return a.localeCompare(b);
}

const existing = fs
  .readdirSync(assetsDir)
  .filter((f) => f.endsWith(".emw"))
  .sort(stableSort);

const names = allow.filter((n) => existing.includes(n));

const items = names.map((name) => {
  const source = readText(path.join(assetsDir, name));
  return { name, source };
});

const header = `// Bundled example scripts for the web dashboard.\n//\n// IMPORTANT: This file is GENERATED from assets/default-scripts/*.emw.\n// Do not edit by hand.\n//\n// Regenerate: node scripts/sync_frontend_example_scripts.js\n\nexport type ExampleEmwScript = {\n  name: string;\n  source: string;\n};\n\nexport const exampleEmwScripts: ExampleEmwScript[] = `;

const body = JSON.stringify(items, null, 2)
  // JSON -> valid TS but we prefer single quotes? Keep JSON for stability.
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const content = `${header}${body} as const;\n`;

fs.writeFileSync(outPath, content);
console.log(`Wrote ${outPath} (${items.length} scripts)`);
