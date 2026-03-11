import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

function dataRoot() {
  return path.resolve(process.cwd(), ".data", "server");
}

function filePath(name: string) {
  return path.join(dataRoot(), `${name}.json`);
}

function ensureRoot() {
  mkdirSync(dataRoot(), { recursive: true });
}

export function readCollection<T>(name: string, fallback: T): T {
  ensureRoot();
  const target = filePath(name);
  if (!existsSync(target)) {
    return fallback;
  }

  try {
    return JSON.parse(readFileSync(target, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeCollection<T>(name: string, value: T) {
  ensureRoot();
  const target = filePath(name);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, target);
}
