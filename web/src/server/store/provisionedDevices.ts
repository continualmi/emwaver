import { readCollection, writeCollection } from "./jsonStore";

export type ProvisionedDeviceRecord = {
  board_type: string;
  hardware_uid: string;
  label: string;
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

  listByUser(firebaseUid: string) {
    return [...this.rows.values()]
      .filter((row) => row.owner_firebase_uid === firebaseUid)
      .sort((a, b) => b.created_at_ms - a.created_at_ms);
  }

  claimOrRestore(input: {
    boardType: string;
    hardwareUid: string;
    ownerFirebaseUid: string;
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
      label: "",
      owner_firebase_uid: input.ownerFirebaseUid,
      created_at_ms: now,
      updated_at_ms: now,
      last_seen_at_ms: now,
    };
    this.rows.set(key, created);
    this.persist();
    return { device: created, created: true } as const;
  }

  hasUserDevice(firebaseUid: string) {
    return [...this.rows.values()].some((row) => row.owner_firebase_uid === firebaseUid);
  }

  setLabel(boardType: string, hardwareUid: string, firebaseUid: string, label: string) {
    const key = makeKey(boardType, hardwareUid);
    const existing = this.rows.get(key);
    if (!existing || existing.owner_firebase_uid !== firebaseUid) {
      return null;
    }

    const next: ProvisionedDeviceRecord = {
      ...existing,
      label: label.slice(0, 128),
      updated_at_ms: nowMs(),
    };
    this.rows.set(key, next);
    this.persist();
    return next;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverProvisionedDevicesStore?: ProvisionedDevicesStore;
};

export const provisionedDevicesStore =
  globalStore.__emwaverProvisionedDevicesStore ?? new ProvisionedDevicesStore();
globalStore.__emwaverProvisionedDevicesStore = provisionedDevicesStore;
