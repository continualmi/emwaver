import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { ordersStore } from "@/server/store/orders";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  return NextResponse.json({ orders: await ordersStore.byUser(identity.uid) });
}
