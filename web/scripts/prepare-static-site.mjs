import { cp, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { statSync } from "node:fs";

const repoRoot = process.cwd();
const exportDir = path.join(repoRoot, "out");
const emwaverDir = path.join(repoRoot, "out-emwaver");

async function copyIfExists(from, to) {
  try {
    await cp(from, to, { recursive: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function prepareEmwaverExport() {
  // Move old out-emwaver aside and create fresh
  await rm(emwaverDir, { recursive: true, force: true });
  await mkdir(emwaverDir, { recursive: true });

  // Copy entire static export to out-emwaver
  // The Next.js output directory is flat — pages are at the root
  const entries = await readdir(exportDir);
  for (const entry of entries) {
    const from = path.join(exportDir, entry);
    const to = path.join(emwaverDir, entry);
    try {
      await cp(from, to, { recursive: true });
    } catch {
      // skip entries that fail
    }
  }
}

await prepareEmwaverExport();

console.log(`Prepared ${path.relative(repoRoot, emwaverDir)} for emwaver.ai`);
