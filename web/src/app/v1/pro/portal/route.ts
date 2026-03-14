import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { getStripe } from "@/server/stripe";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  try {
    const stripe = getStripe();
    const customers = await stripe.customers.list({ email: identity.email || "", limit: 1 });
    const customerId = customers.data[0]?.id;
    if (!customerId) {
      return NextResponse.json({ error: "no_customer", detail: "No Stripe customer found for this email yet." }, { status: 404 });
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
