import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WEB_ROOT } from "@/lib/repoPaths";

type StoredFileMeta = {
  name: string;
  blob_key: string;
  etag: string;
  size_bytes: number;
  last_modified: null;
  content_type: string | null;
  mtime_ms: number;
};

function sanitizeName(raw: string): string | null {
  const name = (raw || "").trim();
  if (!name) return null;
  if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || name.includes("/")) {
    return null;
  }
  return name;
}

function dataRoot() {
  return path.resolve(WEB_ROOT, ".data", "user-files");
}

function userRoot(uid: string) {
  return path.join(dataRoot(), uid);
}

function metaPath(uid: string, name: string) {
  return path.join(userRoot(uid), `${name}.json`);
}

function dataPath(uid: string, name: string) {
  return path.join(userRoot(uid), `${name}.bin`);
}

async function ensureUserRoot(uid: string) {
  await mkdir(userRoot(uid), { recursive: true });
}

export async function listFiles(uid: string): Promise<StoredFileMeta[]> {
  await ensureUserRoot(uid);
  const entries = await readdir(userRoot(uid), { withFileTypes: true });
  const files: StoredFileMeta[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const meta = JSON.parse(await readFile(path.join(userRoot(uid), entry.name), "utf8")) as StoredFileMeta;
    files.push(meta);
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFileContent(uid: string, rawName: string) {
  const name = sanitizeName(rawName);
  if (!name) return null;
  try {
    const meta = JSON.parse(await readFile(metaPath(uid, name), "utf8")) as StoredFileMeta;
    const content = await readFile(dataPath(uid, name));
    return { meta, content };
  } catch {
    return null;
  }
}

export async function saveFile(
  uid: string,
  rawName: string,
  content: Uint8Array,
  contentType: string | null,
  mtimeMs: number,
) {
  const name = sanitizeName(rawName);
  if (!name) return { error: "Missing or invalid 'name'" } as const;

  await ensureUserRoot(uid);
  const bytes = Buffer.from(content);
  await writeFile(dataPath(uid, name), bytes);
  const st = await stat(dataPath(uid, name));
  const meta: StoredFileMeta = {
    name,
    blob_key: `u/${uid}/${name}`,
    etag: `${st.size}-${mtimeMs}`,
    size_bytes: st.size,
    last_modified: null,
    content_type: contentType,
    mtime_ms: mtimeMs,
  };
  await writeFile(metaPath(uid, name), JSON.stringify(meta, null, 2));
  return { meta } as const;
}

export async function deleteFile(uid: string, rawName: string) {
  const name = sanitizeName(rawName);
  if (!name) return { error: "Missing or invalid 'name'" } as const;

  await rm(metaPath(uid, name), { force: true });
  await rm(dataPath(uid, name), { force: true });
  return { ok: true } as const;
}
