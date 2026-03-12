import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";
import { provisionedDevicesStore } from "@/server/store/provisionedDevices";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const merged = new Map<string, {
    device_id_b64: string;
    label: string;
    board_type?: string;
    hardware_uid?: string;
    created_at_ms: number;
    updated_at_ms: number;
    last_seen_at_ms: number;
  }>();

  for (const device of devicesStore.listByUser(identity.uid)) {
    merged.set(device.device_id_b64, {
      device_id_b64: device.device_id_b64,
      label: device.label,
      created_at_ms: device.created_at_ms,
      updated_at_ms: device.updated_at_ms,
      last_seen_at_ms: device.last_seen_at_ms,
    });
  }

  for (const device of provisionedDevicesStore.listByUser(identity.uid)) {
    const existing = merged.get(device.device_id_b64);
    merged.set(device.device_id_b64, {
      device_id_b64: device.device_id_b64,
      label: existing?.label || "",
      board_type: device.board_type,
      hardware_uid: device.hardware_uid,
      created_at_ms: existing?.created_at_ms ?? device.created_at_ms,
      updated_at_ms: Math.max(existing?.updated_at_ms ?? 0, device.updated_at_ms),
      last_seen_at_ms: Math.max(existing?.last_seen_at_ms ?? 0, device.last_seen_at_ms),
    });
  }

  const devices = [...merged.values()].sort((a, b) => b.created_at_ms - a.created_at_ms);

  return NextResponse.json({ devices });
}
