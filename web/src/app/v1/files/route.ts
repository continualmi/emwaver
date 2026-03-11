import { NextResponse, type NextRequest } from "next/server";

import { deleteFile, listFiles } from "@/server/store/files";
import { unauthorizedJson, requireIdentity } from "@/server/http";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  return NextResponse.json({ files: await listFiles(identity.uid) });
}

export async function DELETE(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const name = request.nextUrl.searchParams.get("name") || "";
  const result = await deleteFile(identity.uid, name);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
