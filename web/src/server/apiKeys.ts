import { createHash, randomBytes } from "node:crypto";

import { ensurePlatformSchema, getPlatformPgPool } from "./platformCore";

type ApiKeyStatusRow = {
  key_prefix: string;
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number | null;
  revoked_at_ms: number | null;
};

export type ApiKeyStatus = {
  exists: boolean;
  keyPrefix: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  lastUsedAtMs: number | null;
  revokedAtMs: number | null;
};

export type ApiKeySessionUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  status: string;
  identities: Array<{
    provider: string;
    providerUserId: string;
    email: string | null;
    displayName: string | null;
  }>;
};

function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function generateApiKeyValue() {
  return `emw_sk_${randomBytes(24).toString("base64url")}`;
}

function mapStatus(row: ApiKeyStatusRow | null): ApiKeyStatus {
  if (!row) {
    return {
      exists: false,
      keyPrefix: null,
      createdAtMs: null,
      updatedAtMs: null,
      lastUsedAtMs: null,
      revokedAtMs: null,
    };
  }

  return {
    exists: true,
    keyPrefix: row.key_prefix,
    createdAtMs: Number(row.created_at_ms || 0),
    updatedAtMs: Number(row.updated_at_ms || 0),
    lastUsedAtMs: row.last_used_at_ms == null ? null : Number(row.last_used_at_ms),
    revokedAtMs: row.revoked_at_ms == null ? null : Number(row.revoked_at_ms),
  };
}

export async function getApiKeyStatus(userId: string): Promise<ApiKeyStatus> {
  await ensurePlatformSchema();
  const result = await getPlatformPgPool().query<ApiKeyStatusRow>(
    `
      select
        key_prefix,
        extract(epoch from created_at) * 1000 as created_at_ms,
        extract(epoch from updated_at) * 1000 as updated_at_ms,
        extract(epoch from last_used_at) * 1000 as last_used_at_ms,
        extract(epoch from revoked_at) * 1000 as revoked_at_ms
      from emwaver.account_api_keys
      where user_id = $1::uuid
      limit 1
    `,
    [userId],
  );
  return mapStatus(result.rowCount ? result.rows[0] : null);
}

export async function createOrReplaceApiKey(userId: string) {
  await ensurePlatformSchema();
  const apiKey = generateApiKeyValue();
  const keyHash = hashApiKey(apiKey);
  const keyPrefix = apiKey.slice(0, 16);

  const result = await getPlatformPgPool().query<ApiKeyStatusRow>(
    `
      insert into emwaver.account_api_keys (
        user_id,
        key_hash,
        key_prefix,
        created_at,
        updated_at,
        last_used_at,
        revoked_at
      )
      values ($1::uuid, $2, $3, now(), now(), null, null)
      on conflict (user_id)
      do update set
        key_hash = excluded.key_hash,
        key_prefix = excluded.key_prefix,
        updated_at = now(),
        last_used_at = null,
        revoked_at = null
      returning
        key_prefix,
        extract(epoch from created_at) * 1000 as created_at_ms,
        extract(epoch from updated_at) * 1000 as updated_at_ms,
        extract(epoch from last_used_at) * 1000 as last_used_at_ms,
        extract(epoch from revoked_at) * 1000 as revoked_at_ms
    `,
    [userId, keyHash, keyPrefix],
  );

  return {
    apiKey,
    status: mapStatus(result.rows[0] ?? null),
  };
}

export async function revokeApiKey(userId: string) {
  await ensurePlatformSchema();
  await getPlatformPgPool().query(
    `
      update emwaver.account_api_keys
      set revoked_at = now(), updated_at = now()
      where user_id = $1::uuid
        and revoked_at is null
    `,
    [userId],
  );
}

export async function resolveApiKeySessionUser(apiKey: string): Promise<ApiKeySessionUser | null> {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;

  await ensurePlatformSchema();
  const keyHash = hashApiKey(trimmed);
  const result = await getPlatformPgPool().query<{
    key_id: string;
    uid: string;
    email: string | null;
    display_name: string | null;
  }>(
    `
      select
        k.id as key_id,
        u.id as uid,
        u.email as email,
        u.display_name as display_name
      from emwaver.account_api_keys k
      join core.users u on u.id = k.user_id
      where k.key_hash = $1
        and k.revoked_at is null
      limit 1
    `,
    [keyHash],
  );

  if (!result.rowCount) return null;

  const row = result.rows[0];
  await getPlatformPgPool().query(
    `
      update emwaver.account_api_keys
      set last_used_at = now(), updated_at = now()
      where id = $1::uuid
    `,
    [row.key_id],
  );

  return {
    uid: row.uid,
    email: row.email,
    name: row.display_name,
    picture: null,
    status: "active",
    identities: [
      {
        provider: "continual",
        providerUserId: row.uid,
        email: row.email,
        displayName: row.display_name,
      },
      {
        provider: "emwaver_api_key",
        providerUserId: row.key_id,
        email: row.email,
        displayName: row.display_name,
      },
    ],
  };
}
