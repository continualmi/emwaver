import { NextResponse, type NextRequest } from "next/server";

import { societyStore } from "@/server/store/society";

function parseIntBounded(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw || "", 10);
  const value = Number.isNaN(parsed) ? fallback : parsed;
  return Math.max(min, Math.min(max, value));
}

export async function GET(request: NextRequest) {
  const kind = (request.nextUrl.searchParams.get("kind") || "").trim().toLowerCase() || null;
  const limit = parseIntBounded(request.nextUrl.searchParams.get("limit"), 20, 1, 50);
  const beforeRaw = request.nextUrl.searchParams.get("before_ms");
  const before_ms = beforeRaw == null ? null : Number.parseInt(beforeRaw, 10);

  return NextResponse.json({
    posts: societyStore.listPosts({
      kind,
      limit,
      before_ms: Number.isNaN(before_ms as number) ? null : before_ms,
    }),
  });
}
