import { NextResponse, type NextRequest } from "next/server";

import { requireIdentity } from "@/server/http";
import {
  normalizeBoardType,
  normalizeHardwareUid,
  provisionedDevicesStore,
} from "@/server/store/provisionedDevices";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const boardType = normalizeBoardType(String((payload as Record<string, unknown> | null)?.board_type || "").trim());
  const hardwareUid = normalizeHardwareUid(String((payload as Record<string, unknown> | null)?.hardware_uid || "").trim());
  if (!boardType || !hardwareUid) {
    return NextResponse.json({ error: "missing_board_type_or_hardware_uid" }, { status: 400 });
  }

  const current = provisionedDevicesStore.get(boardType, hardwareUid);
  const identity = await requireIdentity(request);
  if (!identity) {
    return NextResponse.json({
      ok: true,
      attached: false,
      claimed: Boolean(current?.owner_firebase_uid),
      needs_login: true,
    });
  }

  const result = provisionedDevicesStore.claimOrRestore({
    boardType,
    hardwareUid,
    ownerFirebaseUid: identity.uid,
  });
  if ("error" in result) {
    return NextResponse.json({ ok: true, attached: false, claimed: true, needs_login: false });
  }
  return NextResponse.json({ ok: true, attached: true, claimed: true, needs_login: false });
}
