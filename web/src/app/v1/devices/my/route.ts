import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const devices = devicesStore.listByUser(identity.uid).map((device) => ({
    device_id_b64: device.device_id_b64,
    label: device.label,
    created_at_ms: device.created_at_ms,
    updated_at_ms: device.updated_at_ms,
    last_seen_at_ms: device.last_seen_at_ms,
  }));

  return NextResponse.json({ devices });
}
