import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  return NextResponse.json({
    canPurchasePro: true,
    reason: null,
    requiresDeviceAttached: false,
    hasDeviceAttached: false,
  });
}
