type EntitlementRecord = {
  pro_active: boolean;
  pro_expires_at_ms: number | null;
  updated_at_ms: number;
};

class EntitlementsStore {
  private readonly rows = new Map<string, EntitlementRecord>();

  get(uid: string) {
    const existing = this.rows.get(uid);
    if (existing) return existing;

    const everyonePro = ["1", "true", "yes", "on"].includes((process.env.EMWAVER_DEFAULT_PRO || "").trim().toLowerCase());
    if (everyonePro) {
      return {
        pro_active: true,
        pro_expires_at_ms: null,
        updated_at_ms: Date.now(),
      };
    }

    return {
      pro_active: false,
      pro_expires_at_ms: null,
      updated_at_ms: Date.now(),
    };
  }

  set(uid: string, record: EntitlementRecord) {
    this.rows.set(uid, record);
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverEntitlementsStore?: EntitlementsStore;
};

export const entitlementsStore = globalStore.__emwaverEntitlementsStore ?? new EntitlementsStore();
globalStore.__emwaverEntitlementsStore = entitlementsStore;
