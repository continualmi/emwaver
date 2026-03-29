import { NextRequest, NextResponse } from "next/server";

import { consumeNativeHandoffCode } from "@/server/handoffCodes";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";

  const result = await consumeNativeHandoffCode(code);
  if ("error" in result) {
    const status =
      result.error === "already_consumed" ? 409 :
      result.error === "expired" ? 410 :
      result.error === "invalid_code" ? 404 :
      result.error === "unknown_user" ? 404 :
      400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    access_token: result.accessToken,
    handoff_token: result.accessToken,
    user: {
      uid: result.user.uid,
      email: result.user.email ?? null,
      name: result.user.name ?? null,
      status: result.user.status,
      identities: result.user.identities,
    },
  });
}
