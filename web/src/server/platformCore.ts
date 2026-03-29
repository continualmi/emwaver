import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import Stripe from "stripe";
import {
  CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS,
  TOP_UP_UNIT_PLATFORM_TOKENS,
  TOP_UP_USD_PER_1M_TOKENS,
  ensureCoreUserRecord,
  ensureSharedWalletAllowance as ensureSharedWalletAllowanceCore,
  findCoreUserByFirebaseUid,
  getCoreUserById,
  getSharedEntitlementState,
  getWalletSummary as getSharedWalletSummary,
  importLegacyWalletState as importLegacyWalletStateCore,
  setProductEntitlementOverride,
  syncCoreSubscriptionRecord,
  type CoreIdentityInput,
} from "continual-core";

export { CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS, TOP_UP_USD_PER_1M_TOKENS as TOPUP_USD_PER_1M_TOKENS };
export const EMWAVER_PLATFORM_TOKENS_PER_TOPUP_UNIT = TOP_UP_UNIT_PLATFORM_TOKENS;

declare global {
  var __emwaverPlatformPgPool: Pool | undefined;
  var __emwaverPlatformSchemaReady: Promise<void> | undefined;
}

const coreSchemaPath = path.join(
  process.cwd(),
  "node_modules",
  "continual-core",
  "db",
  "core-schema.sql",
);

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
  const [coreSchemaSql, emwaverSchemaSql] = await Promise.all([
    readFile(coreSchemaPath, "utf8"),
    readFile(path.resolve(process.cwd(), "src/server/emwaver-schema.sql"), "utf8"),
  ]);
  return `${coreSchemaSql}\n\n${emwaverSchemaSql}`;
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

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const runtime = {
  ensureSchema: ensurePlatformSchema,
  getPool: getPlatformPgPool,
};

export async function getPlatformUserById(userId: string, clientArg?: PoolClient): Promise<PlatformUser | null> {
  return getCoreUserById(runtime, userId, clientArg) as Promise<PlatformUser | null>;
}

export async function ensurePlatformUser(input: PlatformIdentityInput, clientArg?: PoolClient): Promise<PlatformUser> {
  const normalizedEmail = input.email?.trim() || null;
  const normalizedDisplayName = input.displayName?.trim()
    || normalizedEmail?.split("@")[0]
    || input.firebaseUid.trim()
    || "EMWaver user";
  const identityInput: CoreIdentityInput = looksLikeUuid(input.firebaseUid)
    ? {
        canonicalUserId: input.firebaseUid,
        email: normalizedEmail,
        displayName: normalizedDisplayName,
        identities: [
          {
            provider: "continual",
            providerUserId: input.firebaseUid,
            email: normalizedEmail,
            displayName: normalizedDisplayName,
          },
        ],
      }
    : {
        firebaseUid: input.firebaseUid,
        email: normalizedEmail,
        displayName: normalizedDisplayName,
        identities: [
          {
            provider: "firebase",
            providerUserId: input.firebaseUid,
            email: normalizedEmail,
            displayName: normalizedDisplayName,
          },
        ],
      };
  return ensureCoreUserRecord(runtime, identityInput, clientArg) as Promise<PlatformUser>;
}

export async function findUserByFirebaseUid(firebaseUid: string) {
  if (looksLikeUuid(firebaseUid)) {
    return getPlatformUserById(firebaseUid);
  }
  return findCoreUserByFirebaseUid(runtime, firebaseUid) as Promise<PlatformUser | null>;
}

export async function ensureSharedWalletAllowance(userId: string, clientArg?: PoolClient) {
  const result = await ensureSharedWalletAllowanceCore(runtime, userId, clientArg);
  return result ? { resetsAt: result.periodEnd } : null;
}

export async function getEntitlementState(userId: string, productKey = "emwaver", clientArg?: PoolClient) {
  const result = await getSharedEntitlementState(runtime, userId, productKey, clientArg);
  return {
    pro: result.pro,
    expiresAt: result.expiresAt,
  };
}

export async function upsertEntitlementOverride(input: {
  userId: string;
  productKey: string;
  entitlementKey: string;
  active: boolean;
  endsAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await setProductEntitlementOverride(runtime, input);
}

export async function importLegacyWalletState(input: {
  userId: string;
  balanceTokens: number;
  periodStartMs?: number | null;
  periodEndMs?: number | null;
  sourceRef: string;
  metadata?: Record<string, unknown>;
}) {
  await importLegacyWalletStateCore(runtime, {
    userId: input.userId,
    balanceTokens: input.balanceTokens,
    periodStart: input.periodStartMs ? new Date(input.periodStartMs).toISOString() : null,
    periodEnd: input.periodEndMs ? new Date(input.periodEndMs).toISOString() : null,
    monthlyAllowanceTokens: CONTINUAL_PRO_MONTHLY_ALLOWANCE_TOKENS,
    productKey: "emwaver",
    workloadKey: "legacy_wallet_import",
    sourceRef: input.sourceRef,
    metadata: input.metadata,
  });
}

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  const wallet = await getSharedWalletSummary(runtime, userId);
  return {
    balance: wallet.balance,
    monthlyAllowance: wallet.monthlyAllowance,
    resetsAt: wallet.resetsAt,
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

    const item = subscription.items.data[0];
    await syncCoreSubscriptionRecord(runtime, {
      userId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: item?.price?.id ?? null,
      status: stripeStatusToAppStatus(subscription.status),
      startsAt: timestampToIso(subscription.start_date) ?? new Date().toISOString(),
      endsAt: stripeStatusToAppStatus(subscription.status) === "active"
        ? null
        : timestampToIso(subscription.ended_at ?? subscription.cancel_at ?? item?.current_period_end) ?? new Date().toISOString(),
      currentPeriodStart: timestampToIso(item?.current_period_start),
      currentPeriodEnd: timestampToIso(item?.current_period_end),
      metadata: {
        stripeStatus: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    }, client);

    await ensureSharedWalletAllowance(userId, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
