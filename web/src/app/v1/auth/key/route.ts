import { NextResponse, type NextRequest } from "next/server";

import { getApiKeyStatus } from "@/server/apiKeys";
import { requireIdentity, unauthorizedJson } from "@/server/http";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const key = await getApiKeyStatus(identity.uid);
  return NextResponse.json({
    valid: true,
    user: {
      uid: identity.uid,
      email: identity.email ?? null,
      name: identity.displayName ?? null,
      status: identity.status ?? "active",
    },
    key,
  });
}
