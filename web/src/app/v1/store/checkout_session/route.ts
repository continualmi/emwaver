import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

import { requireIdentity } from "@/server/http";
import { ordersStore } from "@/server/store/orders";
import { getStripe } from "@/server/stripe";

export async function POST(request: NextRequest) {
  const stripePriceId = (process.env.STORE_STRIPE_PRICE_ID || "").trim();
  if (!stripePriceId) {
    return NextResponse.json({ error: "store_not_configured" }, { status: 503 });
  }

  const payload = await request.json().catch(() => null);
  const email = String((payload as Record<string, unknown> | null)?.email || "").trim();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  let quantity = Number.parseInt(String((payload as Record<string, unknown> | null)?.quantity ?? 1), 10);
  if (Number.isNaN(quantity)) quantity = 1;
  quantity = Math.max(1, Math.min(5, quantity));

  const user = await requireIdentity(request);
  let session: Stripe.Checkout.Session;
  try {
    const stripe = getStripe();
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      client_reference_id: user?.uid || undefined,
      line_items: [{ price: stripePriceId, quantity }],
      allow_promotion_codes: false,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ((process.env.STORE_SHIPPING_COUNTRIES || "").split(",").map((v) => v.trim()).filter(Boolean) as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[]) || undefined,
      },
      success_url: `${process.env.STORE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.STORE_CANCEL_URL,
    });
  } catch (error) {
    return NextResponse.json({ error: "stripe_error", detail: String(error) }, { status: 502 });
  }

  const order = ordersStore.createDraft({
    firebase_uid: user?.uid || null,
    email,
    quantity,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: String(session.payment_intent || ""),
    currency: session.currency || "",
    amount_total: session.amount_total || 0,
  });

  return NextResponse.json({ url: session.url, session_id: session.id, order_id: order.id });
}
