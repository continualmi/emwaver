import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = await request.json().catch(() => null);
  const deviceIdB64 = String((payload as Record<string, unknown> | null)?.device_id_b64 || "").trim();
  const label = String((payload as Record<string, unknown> | null)?.label || "").trim();
  if (!deviceIdB64) {
    return NextResponse.json({ error: "missing_device_id_b64" }, { status: 400 });
  }

  const device = devicesStore.setLabel(deviceIdB64, identity.uid, label);
  if (!device) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    device: {
      device_id_b64: device.device_id_b64,
      label: device.label,
      created_at_ms: device.created_at_ms,
      updated_at_ms: device.updated_at_ms,
      last_seen_at_ms: device.last_seen_at_ms,
    },
  });
}
