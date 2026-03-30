import { NextRequest, NextResponse } from "next/server";

import { createOrReplaceApiKey, getApiKeyStatus, revokeApiKey } from "@/server/apiKeys";
import { getVerifiedIdentityFromRequest } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getVerifiedIdentityFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const status = await getApiKeyStatus(user.uid);
  return NextResponse.json({ key: status });
}

export async function POST(request: NextRequest) {
  const user = await getVerifiedIdentityFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const created = await createOrReplaceApiKey(user.uid);
  return NextResponse.json({
    api_key: created.apiKey,
    key: created.status,
  });
}

export async function DELETE(request: NextRequest) {
  const user = await getVerifiedIdentityFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  await revokeApiKey(user.uid);
  return NextResponse.json({ ok: true });
}
