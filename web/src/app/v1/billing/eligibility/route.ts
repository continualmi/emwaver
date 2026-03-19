import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { provisionedDevicesStore } from "@/server/store/provisionedDevices";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const hasDevice = provisionedDevicesStore.hasUserDevice(identity.uid);
  return NextResponse.json({
    canPurchasePro: hasDevice,
    reason: hasDevice ? null : "no_device",
    requiresDeviceAttached: true,
    hasDeviceAttached: hasDevice,
  });
}
