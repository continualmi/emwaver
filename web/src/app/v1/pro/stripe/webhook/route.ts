import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import { entitlementsStore } from "@/server/store/entitlements";
import { getStripe } from "@/server/stripe";

export async function POST(request: NextRequest) {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature") || "";
  const raw = Buffer.from(await request.arrayBuffer());

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json({ error: "invalid_signature", detail: String(error) }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const firebaseUid = String(session.client_reference_id || session.metadata?.firebase_uid || "").trim();
        if (firebaseUid) {
          entitlementsStore.set(firebaseUid, {
            pro_active: true,
            pro_expires_at_ms: null,
            updated_at_ms: Date.now(),
          });
        }
      }
    }
  } catch {
    return NextResponse.json({ error: "webhook_handler_failed" }, { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
