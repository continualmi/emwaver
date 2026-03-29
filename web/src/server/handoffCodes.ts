import { createHash, randomInt } from "node:crypto";

import { ensurePlatformSchema, getPlatformPgPool, getPlatformUserById } from "@/server/platformCore";
import { createSessionToken, type SessionIdentity, type SessionUser } from "@/server/session";

function nowMs() {
  return Date.now();
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  for (let index = 0; index < 6; index += 1) {
    body += alphabet[randomInt(0, alphabet.length)];
  }
  return `EMW-${body}`;
}

function hashCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function normalizeIdentities(user: SessionUser, firebaseUid: string | null): SessionIdentity[] {
  const identities = Array.isArray(user.identities) ? [...user.identities] : [];
  const seen = new Set(identities.map((identity) => `${identity.provider}:${identity.providerUserId}`));

  if (!seen.has(`continual:${user.uid}`)) {
    identities.push({
      provider: "continual",
      providerUserId: user.uid,
      email: user.email ?? null,
      displayName: user.name ?? null,
    });
  }

  if (firebaseUid && !seen.has(`firebase:${firebaseUid}`)) {
    identities.push({
      provider: "firebase",
      providerUserId: firebaseUid,
      email: user.email ?? null,
      displayName: user.name ?? null,
    });
  }

  return identities;
}

export async function issueNativeHandoffCode(user: SessionUser) {
  await ensurePlatformSchema();
  const pool = getPlatformPgPool();
  const expiresAt = new Date(nowMs() + 10 * 60 * 1000);
  const code = randomCode();
  const firebaseUid = user.identities.find((identity) => identity.provider === "firebase")?.providerUserId ?? null;

  await pool.query(
    `
      delete from emwaver.auth_handoff_codes
      where user_id = $1::uuid
    `,
    [user.uid],
  );

  await pool.query(
    `
      insert into emwaver.auth_handoff_codes (code_hash, user_id, firebase_uid, expires_at)
      values ($1, $2::uuid, $3, $4)
    `,
    [hashCode(code), user.uid, firebaseUid, expiresAt.toISOString()],
  );

  return {
    code,
    expiresAtMs: expiresAt.getTime(),
  };
}

export async function consumeNativeHandoffCode(code: string) {
  await ensurePlatformSchema();
  const pool = getPlatformPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const result = await client.query(
      `
        select id, user_id, firebase_uid, expires_at, consumed_at
        from emwaver.auth_handoff_codes
        where code_hash = $1
        limit 1
        for update
      `,
      [hashCode(code)],
    );

    if ((result.rowCount ?? 0) === 0) {
      await client.query("rollback");
      return { error: "invalid_code" } as const;
    }

    const row = result.rows[0]!;
    if (row.consumed_at) {
      await client.query("rollback");
      return { error: "already_consumed" } as const;
    }

    if (new Date(String(row.expires_at)).getTime() <= nowMs()) {
      await client.query("rollback");
      return { error: "expired" } as const;
    }

    await client.query(
      `
        update emwaver.auth_handoff_codes
        set consumed_at = now()
        where id = $1::uuid
      `,
      [row.id],
    );

    const user = await getPlatformUserById(String(row.user_id), client);
    if (!user) {
      await client.query("rollback");
      return { error: "unknown_user" } as const;
    }

    const sessionUser: SessionUser = {
      uid: user.id,
      email: user.email ?? null,
      name: user.display_name ?? null,
      picture: null,
      status: "active",
      identities: normalizeIdentities(
        {
          uid: user.id,
          email: user.email ?? null,
          name: user.display_name ?? null,
          picture: null,
          status: "active",
          identities: [],
        },
        typeof row.firebase_uid === "string" ? row.firebase_uid : null,
      ),
    };

    await client.query("commit");

    return {
      accessToken: createSessionToken(sessionUser),
      user: sessionUser,
    } as const;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
