import { NextResponse, type NextRequest } from "next/server";

import { getFileContent } from "@/server/store/files";
import { unauthorizedJson, requireIdentity } from "@/server/http";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const name = request.nextUrl.searchParams.get("name") || "";
  const file = await getFileContent(identity.uid, name);
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(file.content, {
    status: 200,
    headers: {
      "content-type": file.meta.content_type || "application/octet-stream",
    },
  });
}
