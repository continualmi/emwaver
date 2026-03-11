import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { hostSessionsStore } from "@/server/store/hostSessions";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  return NextResponse.json(hostSessionsStore.list(identity.uid));
}
