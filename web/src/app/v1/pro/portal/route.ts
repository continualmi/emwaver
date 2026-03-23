import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { getStripe } from "@/server/stripe";
import { getPlatformUserById } from "@/server/platformCore";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  try {
    const user = await getPlatformUserById(identity.uid);
    if (!user) return NextResponse.json({ error: "unknown_user" }, { status: 404 });
    const stripe = getStripe();
    const customerId = user.stripe_customer_id;
    if (!customerId) {
      return NextResponse.json({ error: "no_customer", detail: "No shared Continual customer exists for this account yet." }, { status: 404 });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.PRO_CANCEL_URL || process.env.PRO_SUCCESS_URL || new URL("/pro", request.url).toString(),
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return NextResponse.json({ error: "stripe_error", detail: String(error) }, { status: 502 });
  }
}
