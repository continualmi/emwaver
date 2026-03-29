import { ensurePlatformUser, getEntitlementState, upsertEntitlementOverride } from "@/server/platformCore";

export type EntitlementRecord = {
  pro_active: boolean;
  pro_expires_at_ms: number | null;
  updated_at_ms: number;
};

class EntitlementsStore {
  private toRecord(platform: { pro: boolean; expiresAt: string | null }): EntitlementRecord {
    return {
      pro_active: platform.pro,
      pro_expires_at_ms: platform.expiresAt ? new Date(platform.expiresAt).getTime() : null,
      updated_at_ms: Date.now(),
    };
  }

  async get(uid: string, identity?: { email?: string | null; displayName?: string | null }) {
    const user = await ensurePlatformUser({
      firebaseUid: uid,
      email: identity?.email ?? null,
      displayName: identity?.displayName ?? null,
    });
    const platform = await getEntitlementState(user.id, "emwaver");
    return this.toRecord(platform);
  }

  async set(uid: string, record: EntitlementRecord, identity?: { email?: string | null; displayName?: string | null }) {
    const user = await ensurePlatformUser({
      firebaseUid: uid,
      email: identity?.email ?? null,
      displayName: identity?.displayName ?? null,
    });
    await upsertEntitlementOverride({
      userId: user.id,
      productKey: "emwaver",
      entitlementKey: "continual_pro",
      active: record.pro_active,
      endsAt: record.pro_expires_at_ms ? new Date(record.pro_expires_at_ms).toISOString() : null,
      metadata: {
        source: "emwaver_override",
        updatedAtMs: record.updated_at_ms,
      },
    });
    const platform = await getEntitlementState(user.id, "emwaver");
    return this.toRecord(platform);
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverEntitlementsStore?: EntitlementsStore;
};

export const entitlementsStore = globalStore.__emwaverEntitlementsStore ?? new EntitlementsStore();
globalStore.__emwaverEntitlementsStore = entitlementsStore;
