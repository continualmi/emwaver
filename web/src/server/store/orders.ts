import { randomUUID } from "node:crypto";
import {
  ensurePlatformUser,
  findStoreOrderBySessionId,
  listStoreOrdersByUser,
  upsertStoreOrder,
} from "@/server/platformCore";
import { readCollection } from "./jsonStore";

export type OrderRecord = {
  id: string;
  firebase_uid: string | null;
  email: string;
  status: string;
  quantity: number;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string;
  currency: string;
  amount_total: number;
  shipping_json: string;
  created_at_ms: number;
  updated_at_ms: number;
};

function nowMs() {
  return Date.now();
}

function mapPlatformOrder(row: Record<string, unknown>): OrderRecord {
  return {
    id: String(row.id),
    firebase_uid: null,
    email: String(row.email ?? ""),
    status: String(row.status ?? "created"),
    quantity: Number(row.quantity ?? 0),
    stripe_checkout_session_id: String(row.stripe_checkout_session_id ?? ""),
    stripe_payment_intent_id: String(row.stripe_payment_intent_id ?? ""),
    currency: String(row.currency ?? ""),
    amount_total: Number(row.amount_total ?? 0),
    shipping_json: typeof row.shipping_json === "string" ? row.shipping_json : JSON.stringify(row.shipping_json ?? {}),
    created_at_ms: new Date(String(row.created_at ?? new Date().toISOString())).getTime(),
    updated_at_ms: new Date(String(row.updated_at ?? new Date().toISOString())).getTime(),
  };
}

class OrdersStore {
  private readonly legacyRows = new Map<string, OrderRecord>(
    Object.entries(readCollection<Record<string, OrderRecord>>("orders", {})),
  );

  async createDraft(input: {
    firebase_uid: string | null;
    email: string;
    quantity: number;
    stripe_checkout_session_id: string;
    stripe_payment_intent_id: string;
    currency: string;
    amount_total: number;
  }) {
    const now = nowMs();
    const order: OrderRecord = {
      id: randomUUID(),
      firebase_uid: input.firebase_uid,
      email: input.email,
      status: "created",
      quantity: input.quantity,
      stripe_checkout_session_id: input.stripe_checkout_session_id,
      stripe_payment_intent_id: input.stripe_payment_intent_id,
      currency: input.currency,
      amount_total: input.amount_total,
      shipping_json: "{}",
      created_at_ms: now,
      updated_at_ms: now,
    };

    const user = input.firebase_uid
      ? await ensurePlatformUser({ firebaseUid: input.firebase_uid, email: input.email, displayName: null })
      : null;
    const persisted = await upsertStoreOrder({
      externalOrderId: order.id,
      userId: user?.id ?? null,
      email: input.email,
      status: order.status,
      quantity: input.quantity,
      stripeCheckoutSessionId: input.stripe_checkout_session_id,
      stripePaymentIntentId: input.stripe_payment_intent_id,
      currency: input.currency,
      amountTotal: input.amount_total,
      metadata: {
        firebaseUid: input.firebase_uid,
      },
    });

    return mapPlatformOrder(persisted);
  }

  async byUser(firebaseUid: string) {
    const user = await ensurePlatformUser({ firebaseUid, email: null, displayName: null });
    const platformOrders = await listStoreOrdersByUser(user.id);
    if (platformOrders.length > 0) {
      return platformOrders.map((row) => mapPlatformOrder(row));
    }

    const legacyMatches = [...this.legacyRows.values()].filter((row) => row.firebase_uid === firebaseUid);
    if (legacyMatches.length > 0) {
      await Promise.all(legacyMatches.map((row) => upsertStoreOrder({
        externalOrderId: row.id,
        userId: user.id,
        email: row.email,
        status: row.status,
        quantity: row.quantity,
        stripeCheckoutSessionId: row.stripe_checkout_session_id,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        currency: row.currency,
        amountTotal: row.amount_total,
        shippingJson: row.shipping_json,
        metadata: { firebaseUid },
      })));
      const migrated = await listStoreOrdersByUser(user.id);
      if (migrated.length > 0) {
        return migrated.map((row) => mapPlatformOrder(row));
      }
    }

    return legacyMatches.sort((a, b) => b.created_at_ms - a.created_at_ms);
  }

  async claim(sessionId: string, firebaseUid: string) {
    const user = await ensurePlatformUser({ firebaseUid, email: null, displayName: null });
    const platformOrder = await findStoreOrderBySessionId(sessionId);
    if (platformOrder) {
      const currentUserId = platformOrder.user_id ? String(platformOrder.user_id) : null;
      if (currentUserId && currentUserId !== user.id) {
        return { error: "already_claimed" } as const;
      }
      const updated = await upsertStoreOrder({
        externalOrderId: String(platformOrder.id),
        userId: user.id,
        email: String(platformOrder.email ?? ""),
        status: String(platformOrder.status ?? "created"),
        quantity: Number(platformOrder.quantity ?? 1),
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: String(platformOrder.stripe_payment_intent_id ?? ""),
        currency: String(platformOrder.currency ?? ""),
        amountTotal: Number(platformOrder.amount_total ?? 0),
        shippingJson: typeof platformOrder.shipping_json === "string"
          ? platformOrder.shipping_json
          : JSON.stringify(platformOrder.shipping_json ?? {}),
        metadata: { firebaseUid },
      });
      return { order: mapPlatformOrder(updated) } as const;
    }

    const order = [...this.legacyRows.values()]
      .filter((row) => row.stripe_checkout_session_id === sessionId)
      .sort((a, b) => b.created_at_ms - a.created_at_ms)[0] || null;
    if (!order) return { error: "not_found" } as const;
    if (order.firebase_uid && order.firebase_uid !== firebaseUid) {
      return { error: "already_claimed" } as const;
    }
    const persisted = await upsertStoreOrder({
      externalOrderId: order.id,
      userId: user.id,
      email: order.email,
      status: order.status,
      quantity: order.quantity,
      stripeCheckoutSessionId: order.stripe_checkout_session_id,
      stripePaymentIntentId: order.stripe_payment_intent_id,
      currency: order.currency,
      amountTotal: order.amount_total,
      shippingJson: order.shipping_json,
      metadata: { firebaseUid },
    });
    return { order: mapPlatformOrder(persisted) } as const;
  }

  async markCompleted(sessionId: string, updates: Partial<OrderRecord>) {
    const order = [...this.legacyRows.values()]
      .filter((row) => row.stripe_checkout_session_id === sessionId)
      .sort((a, b) => b.created_at_ms - a.created_at_ms)[0] || null;

    const firebaseUid = String(updates.firebase_uid || order?.firebase_uid || "").trim();
    const user = firebaseUid ? await ensurePlatformUser({ firebaseUid, email: order?.email ?? null, displayName: null }) : null;
    const persisted = await upsertStoreOrder({
      externalOrderId: order?.id ?? null,
      userId: user?.id ?? null,
      email: String(updates.email || order?.email || ""),
      status: String(updates.status || order?.status || "completed"),
      quantity: Number(updates.quantity ?? order?.quantity ?? 1),
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: String(updates.stripe_payment_intent_id || order?.stripe_payment_intent_id || ""),
      currency: String(updates.currency || order?.currency || ""),
      amountTotal: Number(updates.amount_total ?? order?.amount_total ?? 0),
      shippingJson: String(updates.shipping_json || order?.shipping_json || "{}"),
      metadata: {
        firebaseUid: firebaseUid || null,
      },
    });

    return mapPlatformOrder(persisted);
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverOrdersStore?: OrdersStore;
};

export const ordersStore = globalStore.__emwaverOrdersStore ?? new OrdersStore();
globalStore.__emwaverOrdersStore = ordersStore;
