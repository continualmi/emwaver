import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { provisionedDevicesStore } from "@/server/store/provisionedDevices";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const devices = provisionedDevicesStore.listByUser(identity.uid).map((device) => ({
    board_type: device.board_type,
    hardware_uid: device.hardware_uid,
    label: device.label,
    created_at_ms: device.created_at_ms,
    updated_at_ms: device.updated_at_ms,
    last_seen_at_ms: device.last_seen_at_ms,
  }));

  return NextResponse.json({ devices });
}
