import { readCollection, writeCollection } from "./jsonStore";

export type ProvisionedDeviceRecord = {
  board_type: string;
  hardware_uid: string;
  device_id_b64: string;
  proof_b64: string;
  owner_firebase_uid: string;
  created_at_ms: number;
  updated_at_ms: number;
  last_seen_at_ms: number;
};

function nowMs() {
  return Date.now();
}

function makeKey(boardType: string, hardwareUid: string) {
  return `${boardType}:${hardwareUid}`;
}

export function normalizeBoardType(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeHardwareUid(value: string) {
  return value.trim().replace(/[-:\s]/g, "").toUpperCase();
}

class ProvisionedDevicesStore {
  private readonly rows = new Map<string, ProvisionedDeviceRecord>(
    Object.entries(readCollection<Record<string, ProvisionedDeviceRecord>>("provisioned_devices", {})),
  );

  private persist() {
    writeCollection("provisioned_devices", Object.fromEntries(this.rows.entries()));
  }

  get(boardType: string, hardwareUid: string) {
    return this.rows.get(makeKey(boardType, hardwareUid)) || null;
  }

  claimOrRestore(input: {
    boardType: string;
    hardwareUid: string;
    ownerFirebaseUid: string;
    deviceIdB64: string;
    proofB64: string;
  }) {
    const now = nowMs();
    const key = makeKey(input.boardType, input.hardwareUid);
    const existing = this.rows.get(key);

    if (existing) {
      if (existing.owner_firebase_uid !== input.ownerFirebaseUid) {
        return { error: "device_owned_by_another_user" } as const;
      }
      const next: ProvisionedDeviceRecord = {
        ...existing,
        updated_at_ms: now,
        last_seen_at_ms: now,
      };
      this.rows.set(key, next);
      this.persist();
      return { device: next, created: false } as const;
    }

    const created: ProvisionedDeviceRecord = {
      board_type: input.boardType,
      hardware_uid: input.hardwareUid,
      device_id_b64: input.deviceIdB64,
      proof_b64: input.proofB64,
      owner_firebase_uid: input.ownerFirebaseUid,
      created_at_ms: now,
      updated_at_ms: now,
      last_seen_at_ms: now,
    };
    this.rows.set(key, created);
    this.persist();
    return { device: created, created: true } as const;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverProvisionedDevicesStore?: ProvisionedDevicesStore;
};

export const provisionedDevicesStore =
  globalStore.__emwaverProvisionedDevicesStore ?? new ProvisionedDevicesStore();
globalStore.__emwaverProvisionedDevicesStore = provisionedDevicesStore;
