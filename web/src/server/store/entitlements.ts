import { ensurePlatformUser, findUserByFirebaseUid, getEntitlementState, upsertEntitlementOverride } from "@/server/platformCore";
import { readCollection, writeCollection } from "./jsonStore";

export type EntitlementRecord = {
  pro_active: boolean;
  pro_expires_at_ms: number | null;
  updated_at_ms: number;
};

function nowMs() {
  return Date.now();
}

class EntitlementsStore {
  private readonly rows = new Map<string, EntitlementRecord>(
    Object.entries(readCollection<Record<string, EntitlementRecord>>("entitlements", {})),
  );

  private persist() {
    writeCollection("entitlements", Object.fromEntries(this.rows.entries()));
  }

  private defaultRecord() {
    const everyonePro = ["1", "true", "yes", "on"].includes((process.env.EMWAVER_DEFAULT_PRO || "").trim().toLowerCase());
    return {
      pro_active: everyonePro,
      pro_expires_at_ms: null,
      updated_at_ms: nowMs(),
    };
  }

  private async importLegacy(uid: string, record: EntitlementRecord) {
    const user = await findUserByFirebaseUid(uid);
    if (!user || !record.pro_active) return;
    await upsertEntitlementOverride({
      userId: user.id,
      productKey: "emwaver",
      entitlementKey: "continual_pro",
      active: true,
      endsAt: record.pro_expires_at_ms ? new Date(record.pro_expires_at_ms).toISOString() : null,
      metadata: {
        source: "legacy_json",
        updatedAtMs: record.updated_at_ms,
      },
    });
  }

  async get(uid: string, identity?: { email?: string | null; displayName?: string | null }) {
    const legacy = this.rows.get(uid) ?? this.defaultRecord();
    const user = await ensurePlatformUser({
      firebaseUid: uid,
      email: identity?.email ?? null,
      displayName: identity?.displayName ?? null,
    });
    const platform = await getEntitlementState(user.id, "emwaver");
    if (platform.pro) {
      return {
        pro_active: true,
        pro_expires_at_ms: platform.expiresAt ? new Date(platform.expiresAt).getTime() : null,
        updated_at_ms: nowMs(),
      };
    }

    if (legacy.pro_active) {
      await this.importLegacy(uid, legacy);
      return legacy;
    }

    return legacy;
  }

  async set(uid: string, record: EntitlementRecord, identity?: { email?: string | null; displayName?: string | null }) {
    this.rows.set(uid, record);
    this.persist();
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
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverEntitlementsStore?: EntitlementsStore;
};

export const entitlementsStore = globalStore.__emwaverEntitlementsStore ?? new EntitlementsStore();
globalStore.__emwaverEntitlementsStore = entitlementsStore;
