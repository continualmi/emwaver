import { NextResponse, type NextRequest } from "next/server";

import { verifyDeviceProof } from "@/server/deviceIdentity";
import { unauthorizedJson, requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const publicKey = (process.env.EMWAVER_ROOT_PUBLIC_KEY_B64 || "").trim();
  if (!publicKey) {
    return NextResponse.json({ error: "root_key_not_configured" }, { status: 503 });
  }

  const payload = await request.json().catch(() => null);
  const deviceIdB64 = String((payload as Record<string, unknown> | null)?.device_id_b64 || "").trim();
  const proofB64 = String((payload as Record<string, unknown> | null)?.proof_b64 || "").trim();
  if (!deviceIdB64 || !proofB64) {
    return NextResponse.json({ error: "missing_device_id_or_proof" }, { status: 400 });
  }

  try {
    await verifyDeviceProof(deviceIdB64, proofB64, publicKey);
  } catch (error) {
    return NextResponse.json({ error: String((error as Error).message || error) }, { status: 400 });
  }

  const result = devicesStore.attach(deviceIdB64, proofB64, identity.uid);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const device = result.device;
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
