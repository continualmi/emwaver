import { randomUUID } from "node:crypto";

import { readCollection, writeCollection } from "./jsonStore";

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

class OrdersStore {
  private readonly rows = new Map<string, OrderRecord>(
    Object.entries(readCollection<Record<string, OrderRecord>>("orders", {})),
  );

  private persist() {
    writeCollection("orders", Object.fromEntries(this.rows.entries()));
  }

  createDraft(input: {
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
    this.rows.set(order.id, order);
    this.persist();
    return order;
  }

  bySessionId(sessionId: string) {
    return [...this.rows.values()]
      .filter((row) => row.stripe_checkout_session_id === sessionId)
      .sort((a, b) => b.created_at_ms - a.created_at_ms)[0] || null;
  }

  byUser(firebaseUid: string) {
    return [...this.rows.values()]
      .filter((row) => row.firebase_uid === firebaseUid)
      .sort((a, b) => b.created_at_ms - a.created_at_ms);
  }

  claim(sessionId: string, firebaseUid: string) {
    const order = this.bySessionId(sessionId);
    if (!order) return { error: "not_found" } as const;
    if (order.firebase_uid && order.firebase_uid !== firebaseUid) {
      return { error: "already_claimed" } as const;
    }
    order.firebase_uid = firebaseUid;
    order.updated_at_ms = nowMs();
    this.rows.set(order.id, order);
    this.persist();
    return { order } as const;
  }

  markCompleted(sessionId: string, updates: Partial<OrderRecord>) {
    const order = this.bySessionId(sessionId);
    if (!order) return null;
    Object.assign(order, updates, { updated_at_ms: nowMs() });
    this.rows.set(order.id, order);
    this.persist();
    return order;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverOrdersStore?: OrdersStore;
};

export const ordersStore = globalStore.__emwaverOrdersStore ?? new OrdersStore();
globalStore.__emwaverOrdersStore = ordersStore;
