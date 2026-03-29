import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool, type PoolClient } from "pg";
import {
  ensureCoreUserRecord,
  importLegacyWalletState,
  loadCoreSchemaSql,
  setProductEntitlementOverride,
} from "continual-core";

type Mode = "inventory" | "migrate" | "verify";

type LegacyUser = {
  id: string;
  firebase_uid: string;
  email: string | null;
  display_name: string | null;
  created_at: number | null;
  last_seen_at: number | null;
};

type LegacyEntitlement = {
  firebase_uid: string;
  pro_active: number;
  pro_expires_at_ms: number | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
};

type LegacyCredit = {
  firebase_uid: string;
  balance_tokens: number;
  period_start_ms: number | null;
  period_end_ms: number | null;
  updated_at_ms: number | null;
};

type LegacyOrder = {
  id: string;
  firebase_uid: string | null;
  email: string;
  status: string;
  quantity: number;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  currency: string | null;
  amount_total: number | null;
  shipping_json: string | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
};

type LegacyHandoffCode = {
  code_hash: string;
  firebase_uid: string;
  created_at_ms: number | null;
  expires_at_ms: number | null;
  consumed_at_ms: number | null;
};

type LegacyDevice = {
  device_id_b64: string;
  proof_b64: string;
  firebase_uid: string;
  label: string | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  last_seen_at_ms: number | null;
};

type InventoryCounts = {
  source: Record<string, number>;
  target: Record<string, number>;
};

type Report = {
  mode: Mode;
  sourceDatabaseUrlRedacted: string;
  targetDatabaseUrlRedacted: string;
  targetSchemaPrepared: boolean;
  inventory: InventoryCounts;
  users: {
    sourceCount: number;
    mapped: Array<{
      sourceUserId: string;
      sourceFirebaseUid: string;
      targetUserId: string;
      email: string | null;
    }>;
  };
  migrated: {
    entitlements: number;
    credits: number;
    storeOrders: number;
    handoffCodes: number;
  };
  skipped: {
    legacyDevices: Array<{
      firebaseUid: string;
      deviceIdB64: string;
      deviceIdHex: string;
      label: string | null;
      reason: string;
    }>;
    outOfScopeTables: Array<{ table: string; count: number; reason: string }>;
  };
  verification: {
    schemaPresence: string[];
    targetPublicLeaks: string[];
    samples: {
      users: Array<{
        firebaseUid: string;
        targetUserId: string;
        email: string | null;
        entitlementRows: number;
        walletRows: number;
      }>;
      storeOrders: Array<{ externalOrderId: string; found: boolean }>;
      handoffCodes: Array<{ codeHash: string; found: boolean }>;
    };
  };
};

type TargetRuntime = {
  ensureSchema: () => Promise<void>;
  getPool: () => Pool;
};

const repoRoot = path.resolve(process.cwd());
const emwaverSchemaPath = path.resolve(repoRoot, "src/server/emwaver-schema.sql");

function requiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  return value || null;
}

function redactDatabaseUrl(value: string) {
  return value.replace(/:[^:@/]+@/, ":***@");
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

function toIsoFromMs(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return null;
  return new Date(Number(value)).toISOString();
}

function sslForConnectionString(value: string) {
  try {
    const parsed = new URL(value);
    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase() ?? "";
    if (sslmode === "disable") return false;
    if (sslmode === "verify-full" || sslmode === "verify-ca") return { rejectUnauthorized: true };
    if (sslmode === "require" || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      return { rejectUnauthorized: false };
    }
  } catch {
    return { rejectUnauthorized: false };
  }
  return false;
}

function createPool(connectionString: string) {
  return new Pool({
    connectionString,
    ssl: sslForConnectionString(connectionString),
    max: 4,
  });
}

async function ensureTargetSchema(targetClient: PoolClient) {
  const [coreSchemaSql, emwaverSchemaSql] = await Promise.all([
    loadCoreSchemaSql(),
    readFile(emwaverSchemaPath, "utf8"),
  ]);
  await targetClient.query(`${coreSchemaSql}\n\n${emwaverSchemaSql}`);
}

async function countRows(client: PoolClient, sql: string) {
  const result = await client.query<{ count: number }>(sql);
  return Number(result.rows[0]?.count ?? 0);
}

async function safeCountRows(client: PoolClient, sql: string) {
  try {
    return await countRows(client, sql);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return 0;
    }
    throw error;
  }
}

async function inventory(sourceClient: PoolClient, targetClient: PoolClient): Promise<InventoryCounts> {
  const source = {
    legacyUsers: await countRows(sourceClient, "select count(*)::int as count from public.users"),
    legacyEntitlements: await countRows(sourceClient, "select count(*)::int as count from public.user_entitlements"),
    legacyCredits: await countRows(sourceClient, "select count(*)::int as count from public.user_credit_balances"),
    legacyStoreOrders: await countRows(sourceClient, "select count(*)::int as count from public.store_orders"),
    legacyHandoffCodes: await countRows(sourceClient, "select count(*)::int as count from public.auth_handoff_codes"),
    legacyDevices: await countRows(sourceClient, "select count(*)::int as count from public.user_devices"),
    legacyAgentConversations: await countRows(sourceClient, "select count(*)::int as count from public.agent_conversations"),
    legacyAgentMessages: await countRows(sourceClient, "select count(*)::int as count from public.agent_messages"),
    legacyHostSessions: await countRows(sourceClient, "select count(*)::int as count from public.host_sessions"),
  };

  const target = {
    coreUsers: await safeCountRows(targetClient, "select count(*)::int as count from core.users"),
    coreEntitlements: await safeCountRows(
      targetClient,
      "select count(*)::int as count from core.entitlement_overrides where product_key = 'emwaver' and entitlement_key = 'continual_pro'",
    ),
    coreWalletAccounts: await safeCountRows(targetClient, "select count(*)::int as count from core.wallet_accounts"),
    coreStoreOrders: await safeCountRows(
      targetClient,
      "select count(*)::int as count from core.store_orders where product_key = 'emwaver'",
    ),
    emwaverAuthHandoffCodes: await safeCountRows(targetClient, "select count(*)::int as count from emwaver.auth_handoff_codes"),
    emwaverProvisionedDevices: await safeCountRows(targetClient, "select count(*)::int as count from emwaver.provisioned_devices"),
  };

  return { source, target };
}

async function loadLegacyUsers(sourceClient: PoolClient) {
  const result = await sourceClient.query<LegacyUser>(
    `
      select id, firebase_uid, email, display_name, created_at, last_seen_at
      from public.users
      order by created_at asc, id asc
    `,
  );
  return result.rows;
}

async function migrateUsers(
  sourceClient: PoolClient,
  runtime: TargetRuntime,
  targetClient: PoolClient,
  report: Report,
) {
  const users = await loadLegacyUsers(sourceClient);
  report.users.sourceCount = users.length;

  const userIdByFirebaseUid = new Map<string, string>();
  for (const user of users) {
    const normalizedEmail = normalizeEmail(user.email);
    const existing = await targetClient.query<{ id: string }>(
      `
        select id::text
        from core.users
        where firebase_uid = $1
           or ($2 <> '' and lower(trim(email)) = $2)
        order by created_at asc
        limit 1
      `,
      [user.firebase_uid, normalizedEmail ?? ""],
    );

    let targetUserId: string;
    if (existing.rowCount) {
      targetUserId = String(existing.rows[0].id);
      await targetClient.query(
        `
          update core.users
          set
            firebase_uid = coalesce(core.users.firebase_uid, $2),
            email = coalesce(core.users.email, $3),
            primary_email = coalesce(core.users.primary_email, $3),
            display_name = coalesce(nullif(core.users.display_name, ''), $4),
            updated_at = now()
          where id = $1::uuid
        `,
        [targetUserId, user.firebase_uid, user.email, user.display_name],
      );
      await targetClient.query(
        `
          insert into core.auth_identities (id, user_id, provider, provider_user_id, email, display_name, metadata)
          values ($1::uuid, $2::uuid, 'firebase', $3, $4, $5, '{}'::jsonb)
          on conflict (provider, provider_user_id)
          do update set
            user_id = excluded.user_id,
            email = excluded.email,
            display_name = excluded.display_name,
            updated_at = now()
        `,
        [randomUUID(), targetUserId, user.firebase_uid, user.email, user.display_name],
      );
      await targetClient.query(
        `
          insert into core.wallet_accounts (user_id)
          values ($1::uuid)
          on conflict (user_id) do nothing
        `,
        [targetUserId],
      );
    } else {
      const targetUser = await ensureCoreUserRecord(runtime, {
        firebaseUid: user.firebase_uid,
        email: user.email,
        displayName: user.display_name,
        status: "active",
      });
      targetUserId = String(targetUser.id);
    }

    userIdByFirebaseUid.set(user.firebase_uid, targetUserId);
    report.users.mapped.push({
      sourceUserId: user.id,
      sourceFirebaseUid: user.firebase_uid,
      targetUserId,
      email: normalizedEmail,
    });
  }

  return userIdByFirebaseUid;
}

async function migrateEntitlements(
  sourceClient: PoolClient,
  runtime: TargetRuntime,
  userIdByFirebaseUid: Map<string, string>,
) {
  const result = await sourceClient.query<LegacyEntitlement>(
    `
      select firebase_uid, pro_active, pro_expires_at_ms, created_at_ms, updated_at_ms
      from public.user_entitlements
      order by updated_at_ms asc nulls first, firebase_uid asc
    `,
  );
  let migrated = 0;
  for (const row of result.rows) {
    const userId = userIdByFirebaseUid.get(row.firebase_uid);
    if (!userId) continue;
    await setProductEntitlementOverride(runtime, {
      userId,
      productKey: "emwaver",
      entitlementKey: "continual_pro",
      active: Boolean(row.pro_active),
      endsAt: toIsoFromMs(row.pro_expires_at_ms),
      metadata: {
        source: "emwaver_legacy_pg",
        legacyFirebaseUid: row.firebase_uid,
        startsAt: toIsoFromMs(row.created_at_ms),
        updatedAtMs: row.updated_at_ms,
      },
    });
    migrated += 1;
  }
  return migrated;
}

async function migrateCredits(
  sourceClient: PoolClient,
  runtime: TargetRuntime,
  userIdByFirebaseUid: Map<string, string>,
) {
  const result = await sourceClient.query<LegacyCredit>(
    `
      select firebase_uid, balance_tokens, period_start_ms, period_end_ms, updated_at_ms
      from public.user_credit_balances
      order by updated_at_ms asc nulls first, firebase_uid asc
    `,
  );
  let migrated = 0;
  for (const row of result.rows) {
    const userId = userIdByFirebaseUid.get(row.firebase_uid);
    if (!userId) continue;
    await importLegacyWalletState(runtime, {
      userId,
      balanceTokens: Number(row.balance_tokens ?? 0),
      monthlyAllowanceTokens: 10_000_000,
      periodStart: toIsoFromMs(row.period_start_ms),
      periodEnd: toIsoFromMs(row.period_end_ms),
      productKey: "emwaver",
      workloadKey: "legacy_pg_wallet_import",
      sourceRef: `legacy_pg_wallet:${row.firebase_uid}:${row.updated_at_ms ?? "unknown"}`,
      metadata: {
        source: "emwaver_legacy_pg",
        legacyFirebaseUid: row.firebase_uid,
      },
    });
    migrated += 1;
  }
  return migrated;
}

async function migrateStoreOrders(
  sourceClient: PoolClient,
  targetClient: PoolClient,
  userIdByFirebaseUid: Map<string, string>,
) {
  const result = await sourceClient.query<LegacyOrder>(
    `
      select
        id,
        firebase_uid,
        email,
        status,
        quantity,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        currency,
        amount_total,
        shipping_json,
        created_at_ms,
        updated_at_ms
      from public.store_orders
      order by created_at_ms asc nulls first, id asc
    `,
  );

  let migrated = 0;
  for (const row of result.rows) {
    const mappedUserId = row.firebase_uid ? userIdByFirebaseUid.get(row.firebase_uid) ?? null : null;
    let shippingJson = "{}";
    try {
      shippingJson = row.shipping_json ? JSON.stringify(JSON.parse(row.shipping_json)) : "{}";
    } catch {
      shippingJson = "{}";
    }
    await targetClient.query(
      `
        insert into core.store_orders (
          id,
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
          metadata,
          created_at,
          updated_at
        )
        values (
          $1::uuid,
          $2,
          $3::uuid,
          'emwaver',
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11::jsonb,
          $12::jsonb,
          $13::timestamptz,
          $14::timestamptz
        )
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
          updated_at = excluded.updated_at
      `,
      [
        row.id,
        row.id,
        mappedUserId,
        row.status,
        row.email,
        row.quantity,
        row.stripe_checkout_session_id,
        row.stripe_payment_intent_id || null,
        row.currency || null,
        row.amount_total ?? null,
        shippingJson,
        JSON.stringify({
          source: "emwaver_legacy_pg",
          legacyFirebaseUid: row.firebase_uid,
        }),
        toIsoFromMs(row.created_at_ms) ?? new Date().toISOString(),
        toIsoFromMs(row.updated_at_ms) ?? new Date().toISOString(),
      ],
    );
    migrated += 1;
  }
  return migrated;
}

async function migrateHandoffCodes(
  sourceClient: PoolClient,
  targetClient: PoolClient,
  userIdByFirebaseUid: Map<string, string>,
) {
  const result = await sourceClient.query<LegacyHandoffCode>(
    `
      select code_hash, firebase_uid, created_at_ms, expires_at_ms, consumed_at_ms
      from public.auth_handoff_codes
      order by created_at_ms asc nulls first, code_hash asc
    `,
  );

  let migrated = 0;
  for (const row of result.rows) {
    const userId = userIdByFirebaseUid.get(row.firebase_uid);
    if (!userId) continue;
    await targetClient.query(
      `
        insert into emwaver.auth_handoff_codes (
          id,
          code_hash,
          user_id,
          firebase_uid,
          created_at,
          expires_at,
          consumed_at
        )
        values ($1::uuid, $2, $3::uuid, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz)
        on conflict (code_hash)
        do update set
          user_id = excluded.user_id,
          firebase_uid = excluded.firebase_uid,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          consumed_at = excluded.consumed_at
      `,
      [
        randomUUID(),
        row.code_hash,
        userId,
        row.firebase_uid,
        toIsoFromMs(row.created_at_ms) ?? new Date().toISOString(),
        toIsoFromMs(row.expires_at_ms) ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        toIsoFromMs(row.consumed_at_ms),
      ],
    );
    migrated += 1;
  }
  return migrated;
}

async function collectSkippedLegacyDevices(sourceClient: PoolClient, report: Report) {
  const result = await sourceClient.query<LegacyDevice>(
    `
      select device_id_b64, proof_b64, firebase_uid, label, created_at_ms, updated_at_ms, last_seen_at_ms
      from public.user_devices
      order by updated_at_ms desc nulls last, firebase_uid asc
    `,
  );
  for (const row of result.rows) {
    report.skipped.legacyDevices.push({
      firebaseUid: row.firebase_uid,
      deviceIdB64: row.device_id_b64,
      deviceIdHex: Buffer.from(row.device_id_b64, "base64").toString("hex"),
      label: row.label,
      reason: "legacy_device_id_cannot_be_losslessly_mapped_to_board_type_plus_hardware_uid",
    });
  }
}

async function collectOutOfScopeTables(sourceClient: PoolClient, report: Report) {
  const counts = [
    {
      table: "public.agent_conversations",
      count: await countRows(sourceClient, "select count(*)::int as count from public.agent_conversations"),
      reason: "agent_history_stays_out_of_scope_for_shared_pg_cutover",
    },
    {
      table: "public.agent_messages",
      count: await countRows(sourceClient, "select count(*)::int as count from public.agent_messages"),
      reason: "agent_history_stays_out_of_scope_for_shared_pg_cutover",
    },
    {
      table: "public.host_sessions",
      count: await countRows(sourceClient, "select count(*)::int as count from public.host_sessions"),
      reason: "single_instance_host_presence_stays_out_of_scope_for_shared_pg_cutover",
    },
  ];
  report.skipped.outOfScopeTables.push(...counts);
}

async function verifyTarget(
  sourceClient: PoolClient,
  targetClient: PoolClient,
  userIdByFirebaseUid: Map<string, string>,
): Promise<Report["verification"]> {
  const schemaResult = await targetClient.query(
    `
      select schema_name
      from information_schema.schemata
      where schema_name in ('core', 'emwaver', 'mdl')
      order by schema_name
    `,
  );
  const leakResult = await targetClient.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('users', 'user_entitlements', 'user_credit_balances', 'store_orders', 'user_devices', 'auth_handoff_codes')
      order by table_name
    `,
  );

  const sampleUsersSource = await sourceClient.query<LegacyUser>(
    `
      select id, firebase_uid, email, display_name, created_at, last_seen_at
      from public.users
      order by created_at asc, id asc
      limit 3
    `,
  );
  const sampleUsers = [];
  for (const row of sampleUsersSource.rows) {
    const targetUserId = userIdByFirebaseUid.get(row.firebase_uid);
    if (!targetUserId) continue;
    const userRows = await targetClient.query("select email from core.users where id = $1::uuid limit 1", [targetUserId]);
    const entitlementRows = await targetClient.query(
      "select count(*)::int as count from core.entitlement_overrides where user_id = $1::uuid and product_key = 'emwaver' and entitlement_key = 'continual_pro'",
      [targetUserId],
    );
    const walletRows = await targetClient.query(
      "select count(*)::int as count from core.wallet_accounts where user_id = $1::uuid",
      [targetUserId],
    );
    sampleUsers.push({
      firebaseUid: row.firebase_uid,
      targetUserId,
      email: userRows.rows[0]?.email ?? null,
      entitlementRows: Number(entitlementRows.rows[0]?.count ?? 0),
      walletRows: Number(walletRows.rows[0]?.count ?? 0),
    });
  }

  const sampleOrdersSource = await sourceClient.query<{ id: string }>(
    "select id from public.store_orders order by created_at_ms asc nulls first, id asc limit 3",
  );
  const sampleOrders = [];
  for (const row of sampleOrdersSource.rows) {
    const result = await targetClient.query(
      "select 1 from core.store_orders where external_order_id = $1 or id = $1::uuid limit 1",
      [row.id],
    );
    sampleOrders.push({ externalOrderId: row.id, found: result.rowCount === 1 });
  }

  const sampleCodesSource = await sourceClient.query<{ code_hash: string }>(
    "select code_hash from public.auth_handoff_codes order by created_at_ms asc nulls first, code_hash asc limit 3",
  );
  const sampleCodes = [];
  for (const row of sampleCodesSource.rows) {
    const result = await targetClient.query(
      "select 1 from emwaver.auth_handoff_codes where code_hash = $1 limit 1",
      [row.code_hash],
    );
    sampleCodes.push({ codeHash: row.code_hash, found: result.rowCount === 1 });
  }

  return {
    schemaPresence: schemaResult.rows.map((row) => row.schema_name),
    targetPublicLeaks: leakResult.rows.map((row) => row.table_name),
    samples: {
      users: sampleUsers,
      storeOrders: sampleOrders,
      handoffCodes: sampleCodes,
    },
  };
}

async function main() {
  const mode = (process.argv[2] ?? "").trim() as Mode;
  if (!["inventory", "migrate", "verify"].includes(mode)) {
    throw new Error("Usage: tsx scripts/shared-postgres-cutover.mts <inventory|migrate|verify> [--report path]");
  }

  const reportPathFlagIndex = process.argv.indexOf("--report");
  const reportPath = reportPathFlagIndex >= 0 ? path.resolve(process.cwd(), process.argv[reportPathFlagIndex + 1]) : null;

  const sourceDatabaseUrl = requiredEnv("SOURCE_DATABASE_URL");
  const targetDatabaseUrl = optionalEnv("TARGET_DATABASE_URL") || requiredEnv("DATABASE_URL");
  const sourcePool = createPool(sourceDatabaseUrl);
  const targetPool = createPool(targetDatabaseUrl);

  const report: Report = {
    mode,
    sourceDatabaseUrlRedacted: redactDatabaseUrl(sourceDatabaseUrl),
    targetDatabaseUrlRedacted: redactDatabaseUrl(targetDatabaseUrl),
    targetSchemaPrepared: false,
    inventory: { source: {}, target: {} },
    users: { sourceCount: 0, mapped: [] },
    migrated: {
      entitlements: 0,
      credits: 0,
      storeOrders: 0,
      handoffCodes: 0,
    },
    skipped: {
      legacyDevices: [],
      outOfScopeTables: [],
    },
    verification: {
      schemaPresence: [],
      targetPublicLeaks: [],
      samples: {
        users: [],
        storeOrders: [],
        handoffCodes: [],
      },
    },
  };

  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();
  const userIdByFirebaseUid = new Map<string, string>();

  const runtime: TargetRuntime = {
    ensureSchema: () => ensureTargetSchema(targetClient),
    getPool: () => targetPool,
  };

  try {
    if (mode === "migrate" || mode === "verify") {
      await ensureTargetSchema(targetClient);
      report.targetSchemaPrepared = true;
    }

    report.inventory = await inventory(sourceClient, targetClient);
    await collectOutOfScopeTables(sourceClient, report);
    await collectSkippedLegacyDevices(sourceClient, report);

    if (mode === "migrate") {
      const mappedUsers = await migrateUsers(sourceClient, runtime, targetClient, report);
      mappedUsers.forEach((value, key) => userIdByFirebaseUid.set(key, value));
      report.migrated.entitlements = await migrateEntitlements(sourceClient, runtime, userIdByFirebaseUid);
      report.migrated.credits = await migrateCredits(sourceClient, runtime, userIdByFirebaseUid);
      report.migrated.storeOrders = await migrateStoreOrders(sourceClient, targetClient, userIdByFirebaseUid);
      report.migrated.handoffCodes = await migrateHandoffCodes(sourceClient, targetClient, userIdByFirebaseUid);
      report.inventory = await inventory(sourceClient, targetClient);
      report.verification = await verifyTarget(sourceClient, targetClient, userIdByFirebaseUid);
    }

    if (mode === "verify") {
      const users = await loadLegacyUsers(sourceClient);
      for (const user of users) {
        const result = await targetClient.query<{ id: string }>(
          `
            select id::text
            from core.users
            where firebase_uid = $1
               or lower(trim(email)) = $2
            order by created_at asc
            limit 1
          `,
          [user.firebase_uid, normalizeEmail(user.email) ?? ""],
        );
        if (result.rowCount) {
          userIdByFirebaseUid.set(user.firebase_uid, String(result.rows[0].id));
        }
      }
      report.users.sourceCount = users.length;
      report.verification = await verifyTarget(sourceClient, targetClient, userIdByFirebaseUid);
    }

    if (reportPath) {
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    throw error;
  } finally {
    sourceClient.release();
    targetClient.release();
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
