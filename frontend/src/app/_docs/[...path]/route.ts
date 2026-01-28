import fs from "fs/promises";
import path from "path";
import { DOCS_CONTENT_DIR } from "@/lib/repoPaths";
import { mimeFromPath } from "@/lib/mime";

function safeJoin(baseDir: string, parts: string[]): string {
  const safePath = path.normalize(parts.join("/"));
  const fullPath = path.resolve(baseDir, safePath);
  if (!fullPath.startsWith(path.resolve(baseDir) + path.sep)) {
    throw new Error("Invalid path");
  }
  return fullPath;
}

export async function GET(
  _req: Request,
  ctx: { params: { path?: string[] } },
) {
  const { path: parts = [] } = ctx.params;

  let filePath: string;
  try {
    filePath = safeJoin(DOCS_CONTENT_DIR, parts);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return new Response("Not found", { status: 404 });
    }

    const buf = await fs.readFile(filePath);
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": mimeFromPath(filePath),
        // Transition path; keep caching conservative.
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
