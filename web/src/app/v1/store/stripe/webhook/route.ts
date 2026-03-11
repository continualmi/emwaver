import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import { ordersStore } from "@/server/store/orders";
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
      const shippingDetails = (session as Stripe.Checkout.Session & { shipping_details?: unknown }).shipping_details;
      const shipping = shippingDetails ? JSON.stringify(shippingDetails) : "{}";
      ordersStore.markCompleted(String(session.id || ""), {
        status: String(session.payment_status || "").toLowerCase() === "paid" ? "paid" : "completed",
        firebase_uid: String(session.client_reference_id || "").trim() || null,
        stripe_payment_intent_id: String(session.payment_intent || ""),
        shipping_json: shipping,
      });
    }
  } catch {
    return NextResponse.json({ error: "webhook_handler_failed" }, { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
