import { NextResponse, type NextRequest } from "next/server";

import { unauthorizedJson, requireIdentity } from "@/server/http";
import { devicesStore } from "@/server/store/devices";
import { getStripe } from "@/server/stripe";

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const priceId = (process.env.PRO_STRIPE_PRICE_ID || "").trim();
  if (!priceId || !(process.env.STRIPE_WEBHOOK_SECRET || "").trim()) {
    return NextResponse.json({ error: "pro_not_configured" }, { status: 503 });
  }
  if (!devicesStore.hasUserDevice(identity.uid)) {
    return NextResponse.json(
      {
        error: "not_eligible",
        reason: "no_device",
        detail: "Connect and attach a genuine EMWaver device to your account before subscribing.",
      },
      { status: 403 },
    );
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: identity.email || undefined,
      client_reference_id: identity.uid,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.PRO_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.PRO_CANCEL_URL || process.env.PRO_SUCCESS_URL,
      metadata: { firebase_uid: identity.uid },
    });
    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (error) {
    return NextResponse.json({ error: "stripe_error", detail: String(error) }, { status: 502 });
  }
}
