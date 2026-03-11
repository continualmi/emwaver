import { readCollection, writeCollection } from "./jsonStore";

export type DeviceRecord = {
  device_id_b64: string;
  proof_b64: string;
  firebase_uid: string | null;
  label: string;
  created_at_ms: number;
  updated_at_ms: number;
  last_seen_at_ms: number;
};

function nowMs() {
  return Date.now();
}

class DevicesStore {
  private readonly rows = new Map<string, DeviceRecord>(
    Object.entries(readCollection<Record<string, DeviceRecord>>("devices", {})),
  );

  private persist() {
    writeCollection("devices", Object.fromEntries(this.rows.entries()));
  }

  get(deviceIdB64: string) {
    return this.rows.get(deviceIdB64) || null;
  }

  attach(deviceIdB64: string, proofB64: string, firebaseUid: string) {
    const now = nowMs();
    const existing = this.rows.get(deviceIdB64);
    if (existing && existing.firebase_uid && existing.firebase_uid !== firebaseUid) {
      return { error: "device_already_attached" } as const;
    }

    const next: DeviceRecord = existing
      ? {
          ...existing,
          proof_b64: proofB64,
          firebase_uid: firebaseUid,
          updated_at_ms: now,
          last_seen_at_ms: now,
        }
      : {
          device_id_b64: deviceIdB64,
          proof_b64: proofB64,
          firebase_uid: firebaseUid,
          label: "",
          created_at_ms: now,
          updated_at_ms: now,
          last_seen_at_ms: now,
        };

    this.rows.set(deviceIdB64, next);
    this.persist();
    return { device: next } as const;
  }

  listByUser(firebaseUid: string) {
    return [...this.rows.values()]
      .filter((row) => row.firebase_uid === firebaseUid)
      .sort((a, b) => b.created_at_ms - a.created_at_ms);
  }

  hasUserDevice(firebaseUid: string) {
    return [...this.rows.values()].some((row) => row.firebase_uid === firebaseUid);
  }

  setLabel(deviceIdB64: string, firebaseUid: string, label: string) {
    const existing = this.rows.get(deviceIdB64);
    if (!existing || existing.firebase_uid !== firebaseUid) {
      return null;
    }
    existing.label = label.slice(0, 128);
    existing.updated_at_ms = nowMs();
    this.rows.set(deviceIdB64, existing);
    this.persist();
    return existing;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverDevicesStore?: DevicesStore;
};

export const devicesStore = globalStore.__emwaverDevicesStore ?? new DevicesStore();
globalStore.__emwaverDevicesStore = devicesStore;
