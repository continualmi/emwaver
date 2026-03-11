import { NextResponse, type NextRequest } from "next/server";

import { verifyDeviceProof } from "@/server/deviceIdentity";
import { requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";

export async function POST(request: NextRequest) {
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

  const current = devicesStore.get(deviceIdB64);
  const identity = await requireIdentity(request);
  if (!identity) {
    return NextResponse.json({
      ok: true,
      attached: false,
      claimed: Boolean(current?.firebase_uid),
      needs_login: true,
    });
  }

  const result = devicesStore.attach(deviceIdB64, proofB64, identity.uid);
  if ("error" in result) {
    return NextResponse.json({ ok: true, attached: false, claimed: true, needs_login: false });
  }
  return NextResponse.json({ ok: true, attached: true, claimed: true, needs_login: false });
}
