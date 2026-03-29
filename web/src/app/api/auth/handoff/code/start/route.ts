import { NextRequest, NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/server/session";
import { issueNativeHandoffCode } from "@/server/handoffCodes";

export async function POST(request: NextRequest) {
  const user = getSessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const result = await issueNativeHandoffCode(user);
  return NextResponse.json({
    code: result.code,
    expires_at_ms: result.expiresAtMs,
    user: {
      email: user.email ?? null,
      name: user.name ?? null,
    },
  });
}
