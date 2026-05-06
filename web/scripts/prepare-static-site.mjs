import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

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
  const emwaverSource = path.join(exportDir, "emwaver");
  await rm(emwaverDir, { recursive: true, force: true });
  await mkdir(emwaverDir, { recursive: true });

  await cp(emwaverSource, emwaverDir, { recursive: true });
  await cp(emwaverSource, path.join(emwaverDir, "emwaver"), { recursive: true });
  await copyIfExists(path.join(exportDir, "_next"), path.join(emwaverDir, "_next"));
  await copyIfExists(path.join(exportDir, "404.html"), path.join(emwaverDir, "404.html"));
  await copyIfExists(path.join(exportDir, "404"), path.join(emwaverDir, "404"));
  await copyIfExists(path.join(exportDir, "favicon.ico"), path.join(emwaverDir, "favicon.ico"));
  await copyIfExists(path.join(exportDir, "favicon.png"), path.join(emwaverDir, "favicon.png"));
  await copyIfExists(path.join(exportDir, "apple-icon.png"), path.join(emwaverDir, "apple-icon.png"));
}

await prepareEmwaverExport();

console.log(`Prepared ${path.relative(repoRoot, emwaverDir)} for emwaver.ai`);
