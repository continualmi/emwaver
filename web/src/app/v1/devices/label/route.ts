import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import {
  normalizeBoardType,
  normalizeHardwareUid,
  provisionedDevicesStore,
} from "@/server/store/provisionedDevices";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = await request.json().catch(() => null);
  const boardType = normalizeBoardType(String((payload as Record<string, unknown> | null)?.board_type || "").trim());
  const hardwareUid = normalizeHardwareUid(String((payload as Record<string, unknown> | null)?.hardware_uid || "").trim());
  const label = String((payload as Record<string, unknown> | null)?.label || "").trim();
  if (!boardType || !hardwareUid) {
    return NextResponse.json({ error: "missing_board_type_or_hardware_uid" }, { status: 400 });
  }

  const device = provisionedDevicesStore.setLabel(boardType, hardwareUid, identity.uid, label);
  if (!device) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    device: {
      board_type: device.board_type,
      hardware_uid: device.hardware_uid,
      label: device.label,
      created_at_ms: device.created_at_ms,
      updated_at_ms: device.updated_at_ms,
      last_seen_at_ms: device.last_seen_at_ms,
    },
  });
}
