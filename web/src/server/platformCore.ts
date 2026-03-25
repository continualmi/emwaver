import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import Stripe from "stripe";

export const CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS = 10_000_000;
export const TOPUP_USD_PER_1M_TOKENS = 1;
export const EMWAVER_PLATFORM_TOKENS_PER_TOPUP_UNIT = 1_000_000;

declare global {
  var __emwaverPlatformPgPool: Pool | undefined;
  var __emwaverPlatformSchemaReady: Promise<void> | undefined;
}

export type PlatformIdentityInput = {
  firebaseUid: string;
  email: string | null;
  displayName: string | null;
};

export type PlatformUser = {
  id: string;
  firebase_uid: string;
  email: string | null;
  display_name: string | null;
  stripe_customer_id: string | null;
};

export type WalletSummary = {
  balance: number;
  monthlyAllowance: number;
  resetsAt: string | null;
};

function readRequiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getDatabaseUrl() {
  return readRequiredEnv("DATABASE_URL");
}

function getPostgresSslConfig() {
  const explicit = String(process.env.PGSSLMODE ?? "").trim().toLowerCase();
  if (explicit === "disable") return false;
  if (explicit === "require" || explicit === "prefer" || explicit === "verify-ca" || explicit === "verify-full") {
    return { rejectUnauthorized: explicit.startsWith("verify") };
  }

  try {
    const databaseUrl = new URL(getDatabaseUrl());
    const sslmode = databaseUrl.searchParams.get("sslmode")?.toLowerCase();
    if (sslmode === "disable") return false;
    if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full") {
      return { rejectUnauthorized: sslmode.startsWith("verify") };
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) {
      return { rejectUnauthorized: false };
    }
  } catch {
    return process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false;
  }

  return false;
}

function createPool() {
  return new Pool({
    connectionString: getDatabaseUrl(),
    max: 10,
    ssl: getPostgresSslConfig(),
  });
}

export function getPlatformPgPool() {
  if (!global.__emwaverPlatformPgPool) {
    global.__emwaverPlatformPgPool = createPool();
  }
  return global.__emwaverPlatformPgPool;
}

async function resolveSharedSchemaSql() {
  const schemaPath = path.resolve(process.cwd(), "../../mdl/db/schema.sql");
  return readFile(schemaPath, "utf8");
}

export async function ensurePlatformSchema() {
  if (!global.__emwaverPlatformSchemaReady) {
    global.__emwaverPlatformSchemaReady = (async () => {
      const pool = getPlatformPgPool();
      const sql = await resolveSharedSchemaSql();
      await pool.query(sql);
    })().catch((error) => {
      global.__emwaverPlatformSchemaReady = undefined;
      throw error;
    });
  }
  await global.__emwaverPlatformSchemaReady;
}

function asIso(value: string | Date | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function canonicalPeriodBounds(row: { current_period_start?: string | Date | null; current_period_end?: string | Date | null }) {
  const now = new Date();
  const start = row.current_period_start ? new Date(row.current_period_start) : now;
  const end = row.current_period_end ? new Date(row.current_period_end) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    start: Number.isNaN(start.getTime()) ? now : start,
    end: Number.isNaN(end.getTime()) ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : end,
  };
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getPlatformUserById(userId: string, clientArg?: PoolClient): Promise<PlatformUser | null> {
  await ensurePlatformSchema();
  const client = clientArg ?? await getPlatformPgPool().connect();
  const shouldRelease = !clientArg;
  try {
    const result = await client.query(
      `
        select id, firebase_uid, email, display_name, stripe_customer_id
        from core.users
        where id = $1::uuid
        limit 1
      `,
      [userId],
    );
    return result.rowCount ? (result.rows[0] as PlatformUser) : null;
  } finally {
    if (shouldRelease) client.release();
  }
}

export async function ensurePlatformUser(input: PlatformIdentityInput, clientArg?: PoolClient): Promise<PlatformUser> {
  await ensurePlatformSchema();
  const client = clientArg ?? await getPlatformPgPool().connect();
  const shouldRelease = !clientArg;
  const normalizedEmail = input.email?.trim() || null;
  const normalizedDisplayName = input.displayName?.trim()
    || normalizedEmail?.split("@")[0]
    || input.firebaseUid.trim()
    || "EMWaver user";
  try {
    if (looksLikeUuid(input.firebaseUid)) {
      const existing = await getPlatformUserById(input.firebaseUid, client);
      if (existing) {
        if (normalizedEmail !== null || input.displayName !== null) {
          const updated = await client.query(
            `
              update core.users
              set
                email = coalesce($2, email),
                display_name = coalesce($3, display_name),
                updated_at = now()
              where id = $1::uuid
              returning id, firebase_uid, email, display_name, stripe_customer_id
            `,
            [input.firebaseUid, normalizedEmail, normalizedDisplayName],
          );
          return updated.rows[0] as PlatformUser;
        }
        return existing;
      }
    }

    const result = await client.query(
      `
        insert into core.users (firebase_uid, email, display_name)
        values ($1, $2, $3)
        on conflict (firebase_uid)
        do update set
          email = excluded.email,
          display_name = excluded.display_name,
          updated_at = now()
        returning id, firebase_uid, email, display_name, stripe_customer_id
      `,
      [input.firebaseUid, normalizedEmail, normalizedDisplayName],
    );

    const user = result.rows[0] as PlatformUser;

    await client.query(
      `
        insert into core.auth_identities (user_id, provider, provider_user_id, email, display_name, metadata)
        values ($1::uuid, 'firebase', $2, $3, $4, '{}'::jsonb)
        on conflict (provider, provider_user_id)
        do update set
          user_id = excluded.user_id,
          email = excluded.email,
          display_name = excluded.display_name,
          updated_at = now()
      `,
      [user.id, input.firebaseUid, normalizedEmail, normalizedDisplayName],
    );

    await client.query(
      `
        insert into core.wallet_accounts (user_id)
        values ($1::uuid)
        on conflict (user_id) do nothing
      `,
      [user.id],
    );

    return user;
  } finally {
    if (shouldRelease) client.release();
  }
}

export async function findUserByFirebaseUid(firebaseUid: string) {
  await ensurePlatformSchema();
  if (looksLikeUuid(firebaseUid)) {
    return getPlatformUserById(firebaseUid);
  }
  const result = await getPlatformPgPool().query(
    `
      select id, firebase_uid, email, display_name, stripe_customer_id
      from core.users
      where firebase_uid = $1
      limit 1
    `,
    [firebaseUid],
  );
  return result.rowCount ? (result.rows[0] as PlatformUser) : null;
}

async function grantWalletTokens(input: {
  userId: string;
  eventType: "subscription_allowance_grant" | "top_up_purchase" | "usage_debit" | "admin_adjustment" | "refund_reversal" | "legacy_import";
  tokensDelta: number;
  productKey?: string | null;
  workloadKey?: string | null;
  sourceRef?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeSubscriptionId?: string | null;
  metadata?: Record<string, unknown>;
}, clientArg?: PoolClient) {
  await ensurePlatformSchema();
  const client = clientArg ?? await getPlatformPgPool().connect();
  const shouldRelease = !clientArg;
  try {
    if (input.sourceRef) {
      const existing = await client.query(
        `select id from core.wallet_ledger where source_ref = $1 limit 1`,
        [input.sourceRef],
      );
      if (existing.rowCount) return false;
    }

    await client.query(
      `
        insert into core.wallet_ledger (
          user_id,
          event_type,
          product_key,
          workload_key,
          tokens_delta,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          stripe_subscription_id,
          source_ref,
          metadata
        )
        values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      `,
      [
        input.userId,
        input.eventType,
        input.productKey ?? null,
        input.workloadKey ?? null,
        input.tokensDelta,
        input.stripeCheckoutSessionId ?? null,
        input.stripePaymentIntentId ?? null,
        input.stripeSubscriptionId ?? null,
        input.sourceRef ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    await client.query(
      `
        insert into core.wallet_accounts (user_id, balance_tokens)
        values ($1::uuid, $2)
        on conflict (user_id)
        do update set
          balance_tokens = core.wallet_accounts.balance_tokens + excluded.balance_tokens,
          updated_at = now()
      `,
      [input.userId, input.tokensDelta],
    );
    return true;
  } finally {
    if (shouldRelease) client.release();
  }
}

async function getActiveSubscription(client: PoolClient, userId: string) {
  const result = await client.query(
    `
      select stripe_subscription_id, current_period_start, current_period_end
      from mdl.user_subscriptions
      where user_id = $1::uuid
        and status = 'active'
        and plan_id in ('plus', 'continual_pro')
        and (ends_at is null or ends_at > now())
      order by starts_at desc
      limit 1
    `,
    [userId],
  );
  return result.rowCount ? (result.rows[0] as {
    stripe_subscription_id: string | null;
    current_period_start: string | Date | null;
    current_period_end: string | Date | null;
  }) : null;
}

export async function ensureSharedWalletAllowance(userId: string, clientArg?: PoolClient) {
  await ensurePlatformSchema();
  const client = clientArg ?? await getPlatformPgPool().connect();
  const shouldRelease = !clientArg;
  try {
    const subscription = await getActiveSubscription(client, userId);
    if (!subscription) return null;

    const period = canonicalPeriodBounds(subscription);
    await grantWalletTokens({
      userId,
      eventType: "subscription_allowance_grant",
      tokensDelta: CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS,
      productKey: "core",
      workloadKey: "continual_pro",
      sourceRef: `subscription_allowance:${userId}:${period.start.toISOString()}`,
      stripeSubscriptionId: subscription.stripe_subscription_id,
      metadata: {
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      },
    }, client);

    await client.query(
      `
        insert into core.wallet_accounts (user_id, monthly_allowance_tokens, current_period_start, current_period_end)
        values ($1::uuid, $2, $3::timestamptz, $4::timestamptz)
        on conflict (user_id)
        do update set
          monthly_allowance_tokens = excluded.monthly_allowance_tokens,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          updated_at = now()
      `,
      [userId, CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS, period.start.toISOString(), period.end.toISOString()],
    );

    return {
      resetsAt: period.end.toISOString(),
    };
  } finally {
    if (shouldRelease) client.release();
  }
}

export async function getEntitlementState(userId: string, productKey = "emwaver", clientArg?: PoolClient) {
  await ensurePlatformSchema();
  const client = clientArg ?? await getPlatformPgPool().connect();
  const shouldRelease = !clientArg;
  try {
    const subscription = await getActiveSubscription(client, userId);
    if (subscription) {
      await ensureSharedWalletAllowance(userId, client);
      return {
        pro: true,
        expiresAt: asIso(subscription.current_period_end),
      };
    }

    const overrideResult = await client.query(
      `
        select ends_at
        from core.entitlement_overrides
        where user_id = $1::uuid
          and product_key = $2
          and entitlement_key = 'continual_pro'
          and active = true
          and (ends_at is null or ends_at > now())
        limit 1
      `,
      [userId, productKey],
    );

    return {
      pro: Number(overrideResult.rowCount ?? 0) > 0,
      expiresAt: asIso(overrideResult.rows[0]?.ends_at ?? null),
    };
  } finally {
    if (shouldRelease) client.release();
  }
}

export async function upsertEntitlementOverride(input: {
  userId: string;
  productKey: string;
  entitlementKey: string;
  active: boolean;
  endsAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ensurePlatformSchema();
  await getPlatformPgPool().query(
    `
      insert into core.entitlement_overrides (
        user_id,
        product_key,
        entitlement_key,
        active,
        ends_at,
        metadata
      )
      values ($1::uuid, $2, $3, $4, $5::timestamptz, $6::jsonb)
      on conflict (user_id, product_key, entitlement_key)
      do update set
        active = excluded.active,
        ends_at = excluded.ends_at,
        metadata = excluded.metadata,
        updated_at = now()
    `,
    [
      input.userId,
      input.productKey,
      input.entitlementKey,
      input.active,
      input.endsAt ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function importLegacyWalletState(input: {
  userId: string;
  balanceTokens: number;
  periodStartMs?: number | null;
  periodEndMs?: number | null;
  sourceRef: string;
  metadata?: Record<string, unknown>;
}) {
  await ensurePlatformSchema();
  const client = await getPlatformPgPool().connect();
  try {
    await client.query("begin");
    await grantWalletTokens({
      userId: input.userId,
      eventType: "legacy_import",
      tokensDelta: input.balanceTokens,
      productKey: "emwaver",
      workloadKey: "legacy_wallet_import",
      sourceRef: input.sourceRef,
      metadata: input.metadata,
    }, client);

    await client.query(
      `
        insert into core.wallet_accounts (user_id, monthly_allowance_tokens, current_period_start, current_period_end)
        values ($1::uuid, $2, $3::timestamptz, $4::timestamptz)
        on conflict (user_id)
        do update set
          monthly_allowance_tokens = excluded.monthly_allowance_tokens,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          updated_at = now()
      `,
      [
        input.userId,
        CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS,
        input.periodStartMs ? new Date(input.periodStartMs).toISOString() : null,
        input.periodEndMs ? new Date(input.periodEndMs).toISOString() : null,
      ],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  await ensurePlatformSchema();
  await ensureSharedWalletAllowance(userId);
  const result = await getPlatformPgPool().query(
    `
      select balance_tokens, monthly_allowance_tokens, current_period_end
      from core.wallet_accounts
      where user_id = $1::uuid
      limit 1
    `,
    [userId],
  );

  if (!result.rowCount) {
    return { balance: 0, monthlyAllowance: 0, resetsAt: null };
  }

  return {
    balance: Number(result.rows[0].balance_tokens ?? 0),
    monthlyAllowance: Number(result.rows[0].monthly_allowance_tokens ?? 0),
    resetsAt: asIso(result.rows[0].current_period_end ?? null),
  };
}

export async function upsertStoreOrder(input: {
  externalOrderId?: string | null;
  userId?: string | null;
  email: string;
  status: string;
  quantity: number;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string | null;
  currency?: string | null;
  amountTotal?: number | null;
  shippingJson?: string;
  metadata?: Record<string, unknown>;
}) {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query(
    `
      insert into core.store_orders (
        external_order_id,
        user_id,
        product_key,
        status,
        email,
        quantity,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        currency,
        amount_total,
        shipping_json,
        metadata
      )
      values ($1, $2::uuid, 'emwaver_store', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
      on conflict (stripe_checkout_session_id)
      do update set
        external_order_id = excluded.external_order_id,
        user_id = coalesce(excluded.user_id, core.store_orders.user_id),
        status = excluded.status,
        email = excluded.email,
        quantity = excluded.quantity,
        stripe_payment_intent_id = excluded.stripe_payment_intent_id,
        currency = excluded.currency,
        amount_total = excluded.amount_total,
        shipping_json = excluded.shipping_json,
        metadata = excluded.metadata,
        updated_at = now()
      returning id, user_id, email, status, quantity, stripe_checkout_session_id, stripe_payment_intent_id, currency,
        amount_total, shipping_json, created_at, updated_at
    `,
    [
      input.externalOrderId ?? null,
      input.userId ?? null,
      input.status,
      input.email,
      input.quantity,
      input.stripeCheckoutSessionId,
      input.stripePaymentIntentId ?? null,
      input.currency ?? null,
      input.amountTotal ?? null,
      input.shippingJson ? input.shippingJson : "{}",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0];
}

export async function listStoreOrdersByUser(userId: string) {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query(
    `
      select id, user_id, email, status, quantity, stripe_checkout_session_id, stripe_payment_intent_id, currency,
        amount_total, shipping_json, created_at, updated_at
      from core.store_orders
      where user_id = $1::uuid
      order by created_at desc
    `,
    [userId],
  );
  return result.rows;
}

export async function findStoreOrderBySessionId(sessionId: string) {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query(
    `
      select id, user_id, email, status, quantity, stripe_checkout_session_id, stripe_payment_intent_id, currency,
        amount_total, shipping_json, created_at, updated_at
      from core.store_orders
      where stripe_checkout_session_id = $1
      limit 1
    `,
    [sessionId],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function upsertProvisionedDevice(input: {
  boardType: string;
  hardwareUid: string;
  ownerUserId: string;
  ownerFirebaseUid: string;
  label?: string;
}) {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query(
    `
      insert into emwaver.provisioned_devices (
        board_type,
        hardware_uid,
        owner_user_id,
        owner_firebase_uid,
        label,
        created_at,
        updated_at,
        last_seen_at,
        metadata
      )
      values ($1, $2, $3::uuid, $4, $5, now(), now(), now(), '{}'::jsonb)
      on conflict (board_type, hardware_uid)
      do update set
        owner_user_id = case
          when emwaver.provisioned_devices.owner_user_id is null or emwaver.provisioned_devices.owner_user_id = excluded.owner_user_id
            then excluded.owner_user_id
          else emwaver.provisioned_devices.owner_user_id
        end,
        owner_firebase_uid = case
          when emwaver.provisioned_devices.owner_user_id is null or emwaver.provisioned_devices.owner_user_id = excluded.owner_user_id
            then excluded.owner_firebase_uid
          else emwaver.provisioned_devices.owner_firebase_uid
        end,
        label = case
          when emwaver.provisioned_devices.label = '' then excluded.label
          else emwaver.provisioned_devices.label
        end,
        updated_at = now(),
        last_seen_at = now()
      returning board_type, hardware_uid, owner_user_id, owner_firebase_uid, label,
        extract(epoch from created_at) * 1000 as created_at_ms,
        extract(epoch from updated_at) * 1000 as updated_at_ms,
        extract(epoch from last_seen_at) * 1000 as last_seen_at_ms
    `,
    [input.boardType, input.hardwareUid, input.ownerUserId, input.ownerFirebaseUid, input.label ?? ""],
  );
  return result.rows[0];
}

export async function getProvisionedDevice(boardType: string, hardwareUid: string) {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query(
    `
      select board_type, hardware_uid, owner_user_id, owner_firebase_uid, label,
        extract(epoch from created_at) * 1000 as created_at_ms,
        extract(epoch from updated_at) * 1000 as updated_at_ms,
        extract(epoch from last_seen_at) * 1000 as last_seen_at_ms
      from emwaver.provisioned_devices
      where board_type = $1 and hardware_uid = $2
      limit 1
    `,
    [boardType, hardwareUid],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function listProvisionedDevicesByUser(userId: string) {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query(
    `
      select board_type, hardware_uid, owner_user_id, owner_firebase_uid, label,
        extract(epoch from created_at) * 1000 as created_at_ms,
        extract(epoch from updated_at) * 1000 as updated_at_ms,
        extract(epoch from last_seen_at) * 1000 as last_seen_at_ms
      from emwaver.provisioned_devices
      where owner_user_id = $1::uuid
      order by last_seen_at desc, created_at desc
    `,
    [userId],
  );
  return result.rows;
}

export async function setProvisionedDeviceLabel(input: {
  boardType: string;
  hardwareUid: string;
  userId: string;
  label: string;
}) {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query(
    `
      update emwaver.provisioned_devices
      set label = $4, updated_at = now()
      where board_type = $1
        and hardware_uid = $2
        and owner_user_id = $3::uuid
      returning board_type, hardware_uid, owner_user_id, owner_firebase_uid, label,
        extract(epoch from created_at) * 1000 as created_at_ms,
        extract(epoch from updated_at) * 1000 as updated_at_ms,
        extract(epoch from last_seen_at) * 1000 as last_seen_at_ms
    `,
    [input.boardType, input.hardwareUid, input.userId, input.label.slice(0, 128)],
  );
  return result.rowCount ? result.rows[0] : null;
}

function getStripePriceId(kind: "continual_pro" | "top_up") {
  if (kind === "continual_pro") {
    return String(process.env.CONTINUAL_PRO_STRIPE_PRICE_ID || process.env.PRO_STRIPE_PRICE_ID || "").trim();
  }
  return String(process.env.CONTINUAL_TOP_UP_STRIPE_PRICE_ID || process.env.TOP_UP_STRIPE_PRICE_ID || "").trim();
}

let stripeClient: Stripe | null = null;

function getStripe() {
  const secretKey = readRequiredEnv("STRIPE_SECRET_KEY");
  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }
  return stripeClient;
}

export async function ensureStripeCustomerForUser(user: PlatformUser, clientArg?: PoolClient) {
  const client = clientArg ?? await getPlatformPgPool().connect();
  const shouldRelease = !clientArg;
  try {
    if (user.stripe_customer_id) return user.stripe_customer_id;
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: user.display_name ?? undefined,
      metadata: {
        userId: user.id,
        firebaseUid: user.firebase_uid,
      },
    });
    await client.query(
      `
        update core.users
        set stripe_customer_id = $2, updated_at = now()
        where id = $1::uuid
      `,
      [user.id, customer.id],
    );
    return customer.id;
  } finally {
    if (shouldRelease) client.release();
  }
}

export async function createContinualProCheckoutSession(user: PlatformUser) {
  const priceId = getStripePriceId("continual_pro");
  if (!priceId) {
    throw new Error("CONTINUAL_PRO_STRIPE_PRICE_ID or PRO_STRIPE_PRICE_ID is required");
  }
  const stripe = getStripe();
  const customerId = await ensureStripeCustomerForUser(user);
  const successUrl = String(process.env.PRO_SUCCESS_URL || "").trim();
  const cancelUrl = String(process.env.PRO_CANCEL_URL || successUrl).trim();
  if (!successUrl) {
    throw new Error("PRO_SUCCESS_URL is required");
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: {
      userId: user.id,
      firebase_uid: user.firebase_uid,
      product: "continual_pro",
    },
    subscription_data: {
      metadata: {
        userId: user.id,
        firebase_uid: user.firebase_uid,
        product: "continual_pro",
      },
    },
  });
  return session;
}

function stripeStatusToAppStatus(status: Stripe.Subscription.Status): "active" | "canceled" | "expired" {
  if (status === "active" || status === "trialing" || status === "past_due") return "active";
  if (status === "canceled" || status === "unpaid") return "canceled";
  return "expired";
}

function timestampToIso(value: number | null | undefined) {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

export async function syncContinualSubscriptionFromStripe(subscription: Stripe.Subscription) {
  await ensurePlatformSchema();
  const client = await getPlatformPgPool().connect();
  try {
    await client.query("begin");
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const userId = String(subscription.metadata?.userId || "").trim();
    if (!userId) {
      throw new Error(`Could not resolve user for Stripe customer ${customerId}`);
    }

    await client.query(
      `
        update core.users
        set stripe_customer_id = $2, updated_at = now()
        where id = $1::uuid
      `,
      [userId, customerId],
    );

    await client.query(
      `
        update mdl.user_subscriptions
        set status = case when status = 'active' then 'canceled' else status end,
            ends_at = coalesce(ends_at, $2::timestamptz),
            updated_at = now()
        where user_id = $1::uuid
          and status = 'active'
          and stripe_subscription_id is distinct from $3
      `,
      [userId, timestampToIso(subscription.ended_at ?? subscription.cancel_at) ?? new Date().toISOString(), subscription.id],
    );

    const item = subscription.items.data[0];
    await client.query(
      `
        insert into mdl.user_subscriptions (
          user_id,
          plan_id,
          stripe_subscription_id,
          stripe_price_id,
          status,
          starts_at,
          ends_at,
          current_period_start,
          current_period_end,
          metadata
        )
        values (
          $1::uuid,
          'continual_pro',
          $2,
          $3,
          $4,
          $5::timestamptz,
          $6::timestamptz,
          $7::timestamptz,
          $8::timestamptz,
          $9::jsonb
        )
        on conflict (stripe_subscription_id)
        do update set
          plan_id = excluded.plan_id,
          stripe_price_id = excluded.stripe_price_id,
          status = excluded.status,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          metadata = excluded.metadata,
          updated_at = now()
      `,
      [
        userId,
        subscription.id,
        item?.price?.id ?? null,
        stripeStatusToAppStatus(subscription.status),
        timestampToIso(subscription.start_date) ?? new Date().toISOString(),
        stripeStatusToAppStatus(subscription.status) === "active"
          ? null
          : timestampToIso(subscription.ended_at ?? subscription.cancel_at ?? item?.current_period_end) ?? new Date().toISOString(),
        timestampToIso(item?.current_period_start),
        timestampToIso(item?.current_period_end),
        JSON.stringify({
          stripeStatus: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        }),
      ],
    );

    await ensureSharedWalletAllowance(userId, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
