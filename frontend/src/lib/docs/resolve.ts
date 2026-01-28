import fs from "fs/promises";
import path from "path";
import { DOCS_CONTENT_DIR } from "@/lib/repoPaths";

export type ResolvedDoc =
  | { kind: "markdown"; filePath: string; relPath: string }
  | { kind: "html"; filePath: string; relPath: string };

async function existsFile(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function existsDir(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function safeResolveContent(relPath: string): string {
  const full = path.resolve(DOCS_CONTENT_DIR, relPath);
  if (!full.startsWith(path.resolve(DOCS_CONTENT_DIR) + path.sep)) {
    throw new Error("Invalid path");
  }
  return full;
}

export async function resolveDocBySlug(slugParts: string[]): Promise<ResolvedDoc | null> {
  const relBase = slugParts.join("/");
  const candidates = [
    `${relBase}.md`,
    `${relBase}.html`,
    path.posix.join(relBase, "index.md"),
    path.posix.join(relBase, "index.html"),
  ];

  for (const relPath of candidates) {
    let full: string;
    try {
      full = safeResolveContent(relPath);
    } catch {
      continue;
    }
    if (await existsFile(full)) {
      if (relPath.endsWith(".md")) return { kind: "markdown", filePath: full, relPath };
      if (relPath.endsWith(".html")) return { kind: "html", filePath: full, relPath };
    }
  }

  // If this is an actual directory, show its index if present.
  try {
    const fullDir = safeResolveContent(relBase);
    if (await existsDir(fullDir)) {
      const indexMd = safeResolveContent(path.posix.join(relBase, "index.md"));
      if (await existsFile(indexMd)) return { kind: "markdown", filePath: indexMd, relPath: path.posix.join(relBase, "index.md") };
      const indexHtml = safeResolveContent(path.posix.join(relBase, "index.html"));
      if (await existsFile(indexHtml)) return { kind: "html", filePath: indexHtml, relPath: path.posix.join(relBase, "index.html") };
    }
  } catch {
    // ignore
  }

  return null;
}
