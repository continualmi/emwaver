import { NextResponse, type NextRequest } from "next/server";

import { mintDeviceIdentity } from "@/server/deviceIdentity";
import { unauthorizedJson, requireIdentity } from "@/server/http";
import {
  normalizeBoardType,
  normalizeHardwareUid,
  provisionedDevicesStore,
} from "@/server/store/provisionedDevices";

function isEnabled() {
  return ["1", "true", "yes", "on"].includes((process.env.EMWAVER_PROVISIONING_ENABLED || "").trim().toLowerCase());
}

export async function POST(request: NextRequest) {
  if (!isEnabled()) {
    return NextResponse.json({ error: "disabled" }, { status: 503 });
  }

  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const allowedUids = (process.env.EMWAVER_PROVISIONING_ALLOWED_UIDS || "").split(",").map((v) => v.trim()).filter(Boolean);
  const allowedEmail = (process.env.EMWAVER_PROVISIONING_ALLOWED_EMAIL || "").trim().toLowerCase();
  if (allowedUids.length > 0 ? !allowedUids.includes(identity.uid) : identity.email?.toLowerCase() !== allowedEmail) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const privateKey = (process.env.EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64 || "").trim();
  if (!privateKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    const payload = await request.json().catch(() => null);
    const rawBoardType = String((payload as Record<string, unknown> | null)?.board_type || "").trim();
    const rawHardwareUid = String((payload as Record<string, unknown> | null)?.hardware_uid || "").trim();

    if (!rawBoardType && !rawHardwareUid) {
      return NextResponse.json(await mintDeviceIdentity(privateKey));
    }

    const boardType = normalizeBoardType(rawBoardType);
    const hardwareUid = normalizeHardwareUid(rawHardwareUid);
    if (!boardType || !/^[a-z0-9._-]+$/.test(boardType)) {
      return NextResponse.json({ error: "invalid_board_type" }, { status: 400 });
    }
    if (!hardwareUid || !/^[A-F0-9]{8,128}$/.test(hardwareUid)) {
      return NextResponse.json({ error: "invalid_hardware_uid" }, { status: 400 });
    }

    const existing = provisionedDevicesStore.get(boardType, hardwareUid);
    const minted = existing
      ? {
          device_id_b64: existing.device_id_b64,
          proof_b64: existing.proof_b64,
        }
      : await mintDeviceIdentity(privateKey);
    const result = provisionedDevicesStore.claimOrRestore({
      boardType,
      hardwareUid,
      ownerFirebaseUid: identity.uid,
      deviceIdB64: minted.device_id_b64,
      proofB64: minted.proof_b64,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({
      device_id_b64: result.device.device_id_b64,
      proof_b64: result.device.proof_b64,
      algorithm: "ed25519",
      device_id_len: 16,
      proof_len: 64,
      board_type: result.device.board_type,
      hardware_uid: result.device.hardware_uid,
      created: result.created,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
