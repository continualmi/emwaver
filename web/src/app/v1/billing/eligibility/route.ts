import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const hasDevice = devicesStore.hasUserDevice(identity.uid);
  return NextResponse.json({
    canPurchasePro: hasDevice,
    reason: hasDevice ? null : "no_device",
    requiresDeviceAttached: true,
    hasDeviceAttached: hasDevice,
  });
}
