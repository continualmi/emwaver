import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { saveFile } from "@/server/store/files";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const name = String((payload as Record<string, unknown>).name || "");
  const contentTypeRaw = (payload as Record<string, unknown>).content_type;
  const dataBase64 = (payload as Record<string, unknown>).data_base64;
  const mtimeMsRaw = (payload as Record<string, unknown>).mtime_ms;

  if (!name.trim()) {
    return NextResponse.json({ error: "Missing or invalid 'name'" }, { status: 400 });
  }
  if (typeof dataBase64 !== "string" || !dataBase64.trim()) {
    return NextResponse.json({ error: "Missing 'data_base64'" }, { status: 400 });
  }
  if (contentTypeRaw != null && typeof contentTypeRaw !== "string") {
    return NextResponse.json({ error: "Invalid 'content_type'" }, { status: 400 });
  }

  let data: Buffer;
  try {
    data = Buffer.from(dataBase64, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid base64 in 'data_base64'" }, { status: 400 });
  }

  const mtimeMs = mtimeMsRaw == null ? Date.now() : Number.parseInt(String(mtimeMsRaw), 10);
  if (Number.isNaN(mtimeMs)) {
    return NextResponse.json({ error: "Invalid 'mtime_ms'" }, { status: 400 });
  }

  const result = await saveFile(identity.uid, name, data, (contentTypeRaw as string | null) || null, mtimeMs);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, file: result.meta });
}
