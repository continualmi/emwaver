import { NextResponse, type NextRequest } from "next/server";

import { mintDeviceIdentity } from "@/server/deviceIdentity";
import { unauthorizedJson, requireIdentity } from "@/server/http";

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
    return NextResponse.json(await mintDeviceIdentity(privateKey));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
