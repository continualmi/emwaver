#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const manifestDir = path.join(root, "docs", "parity", "features");
const platforms = ["macos", "ios", "windows", "android", "linux"];
const allowedStatuses = new Set(["required", "optional", "not_applicable", "planned"]);
const allowedParityModes = new Set(["all_required", "documented_exceptions"]);

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

function listFiles(target) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return [target];

  const out = [];
  const stack = [target];
  while (stack.length) {
    const rel = stack.pop();
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (!["build", "bin", "obj", "target", ".gradle", ".build", "DerivedData"].includes(entry.name)) {
          stack.push(child);
        }
      } else {
        out.push(child);
      }
    }
  }
  return out;
}

function compilePattern(raw, context) {
  try {
    return new RegExp(raw, "s");
  } catch (error) {
    throw new Error(`${context}: invalid regex ${JSON.stringify(raw)}: ${error.message}`);
  }
}

function manifestFiles() {
  if (!fs.existsSync(manifestDir)) {
    throw new Error(`Missing parity manifest directory: ${path.relative(root, manifestDir)}`);
  }
  return fs.readdirSync(manifestDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(manifestDir, name));
}

function loadManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(root, file)}: invalid JSON: ${error.message}`);
  }
}

function validateEvidence(feature, platform, item, failures) {
  const prefix = `${feature.id}/${platform}`;
  if (!item?.file) {
    failures.push(`${prefix}: evidence item is missing file`);
    return;
  }
  if (!exists(item.file)) {
    failures.push(`${prefix}: missing evidence file ${item.file}`);
    return;
  }

  const patterns = Array.isArray(item.contains) ? item.contains : item.contains ? [item.contains] : [];
  const content = read(item.file);
  for (const rawPattern of patterns) {
    const pattern = compilePattern(rawPattern, `${prefix}:${item.file}`);
    if (!pattern.test(content)) {
      failures.push(`${prefix}: ${item.file} did not match /${rawPattern}/`);
    }
  }
}

function validateForbidden(feature, item, failures) {
  const prefix = `${feature.id}/forbidden`;
  if (!item?.path || !item.pattern) {
    failures.push(`${prefix}: forbidden item needs path and pattern`);
    return;
  }

  const pattern = compilePattern(item.pattern, `${prefix}:${item.path}`);
  for (const file of listFiles(item.path)) {
    const content = read(file);
    if (pattern.test(content)) {
      const reason = item.reason ? ` (${item.reason})` : "";
      failures.push(`${prefix}: forbidden pattern /${item.pattern}/ found in ${file}${reason}`);
    }
  }
}

function validateManifest(manifest, relFile, failures, rows) {
  if (!manifest.component) failures.push(`${relFile}: missing component`);
  if (!Array.isArray(manifest.features) || manifest.features.length === 0) {
    failures.push(`${relFile}: missing non-empty features array`);
    return;
  }

  for (const feature of manifest.features) {
    if (!feature.id) {
      failures.push(`${relFile}: feature missing id`);
      continue;
    }
    if (!feature.description) failures.push(`${feature.id}: missing description`);
    if (!allowedParityModes.has(feature.parity)) failures.push(`${feature.id}: invalid parity mode ${JSON.stringify(feature.parity)}`);
    if (!feature.platforms || typeof feature.platforms !== "object") {
      failures.push(`${feature.id}: missing platforms block`);
      continue;
    }

    const missingPlatforms = platforms.filter((platform) => !feature.platforms[platform]);
    if (missingPlatforms.length) {
      failures.push(`${feature.id}: missing platform entries for ${missingPlatforms.join(", ")}`);
    }

    const statuses = [];
    for (const platform of platforms) {
      const spec = feature.platforms[platform];
      if (!spec) continue;
      if (!allowedStatuses.has(spec.status)) {
        failures.push(`${feature.id}/${platform}: invalid status ${JSON.stringify(spec.status)}`);
        continue;
      }
      statuses.push(spec.status);

      if (spec.status === "required") {
        if (!Array.isArray(spec.evidence) || spec.evidence.length === 0) {
          failures.push(`${feature.id}/${platform}: required feature needs evidence`);
        }
      } else if (!spec.reason?.trim()) {
        failures.push(`${feature.id}/${platform}: ${spec.status} status needs a reason`);
      }

      for (const item of spec.evidence ?? []) {
        validateEvidence(feature, platform, item, failures);
      }
    }

    if (feature.parity === "all_required" && statuses.some((status) => status !== "required")) {
      failures.push(`${feature.id}: parity=all_required but statuses are ${statuses.join(", ")}`);
    }

    for (const item of feature.forbidden ?? []) {
      validateForbidden(feature, item, failures);
    }

    rows.push({
      component: manifest.component ?? "unknown",
      id: feature.id,
      statuses: platforms.map((platform) => `${platform}:${feature.platforms?.[platform]?.status ?? "missing"}`).join(" "),
    });
  }
}

const failures = [];
const rows = [];

for (const file of manifestFiles()) {
  const manifest = loadManifest(file);
  validateManifest(manifest, path.relative(root, file), failures, rows);
}

console.log("Platform feature parity suite:");
for (const row of rows) {
  console.log(`- ${row.component}/${row.id}: ${row.statuses}`);
}

if (failures.length > 0) {
  console.error("\nFailures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nPlatform feature parity verification passed (${rows.length} features).`);
