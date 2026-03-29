import { ensurePlatformUser, importLegacyWalletState, upsertEntitlementOverride } from "../src/server/platformCore";
import { readCollection } from "../src/server/store/jsonStore";

type EntitlementRecord = {
  pro_active: boolean;
  pro_expires_at_ms: number | null;
  updated_at_ms: number;
};

type CreditRecord = {
  balance_tokens: number;
  monthly_allowance_tokens?: number;
  period_start_ms: number | null;
  period_end_ms: number | null;
  updated_at_ms: number;
};

async function migrateEntitlements() {
  const rows = readCollection<Record<string, EntitlementRecord>>("entitlements", {});
  let migrated = 0;

  for (const [firebaseUid, row] of Object.entries(rows)) {
    if (!row.pro_active) continue;
    const user = await ensurePlatformUser({
      firebaseUid,
      email: null,
      displayName: null,
    });
    await upsertEntitlementOverride({
      userId: user.id,
      productKey: "emwaver",
      entitlementKey: "continual_pro",
      active: true,
      endsAt: row.pro_expires_at_ms ? new Date(row.pro_expires_at_ms).toISOString() : null,
      metadata: {
        source: "legacy_json_migration",
        firebaseUid,
        updatedAtMs: row.updated_at_ms,
      },
    });
    migrated += 1;
  }

  return migrated;
}

async function migrateCredits() {
  const rows = readCollection<Record<string, CreditRecord>>("credits", {});
  let migrated = 0;

  for (const [firebaseUid, row] of Object.entries(rows)) {
    if (row.balance_tokens <= 0 && !row.period_end_ms) continue;
    const user = await ensurePlatformUser({
      firebaseUid,
      email: null,
      displayName: null,
    });
    await importLegacyWalletState({
      userId: user.id,
      balanceTokens: row.balance_tokens,
      periodStartMs: row.period_start_ms,
      periodEndMs: row.period_end_ms,
      sourceRef: `legacy_wallet:${firebaseUid}:${row.updated_at_ms}`,
      metadata: {
        source: "legacy_json_migration",
        firebaseUid,
      },
    });
    migrated += 1;
  }

  return migrated;
}

async function main() {
  const [entitlements, credits] = await Promise.all([
    migrateEntitlements(),
    migrateCredits(),
  ]);

  console.log(`Migrated ${entitlements} entitlement record(s) into core/emwaver state.`);
  console.log(`Migrated ${credits} wallet record(s) into core wallet state.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
