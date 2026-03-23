import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import { getStripe } from "@/server/stripe";
import { syncContinualSubscriptionFromStripe } from "@/server/platformCore";

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
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncContinualSubscriptionFromStripe(event.data.object as Stripe.Subscription);
    }
  } catch {
    return NextResponse.json({ error: "webhook_handler_failed" }, { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
