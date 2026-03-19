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

function canonicalHardwareUid(boardType: string, hardwareUid: string) {
  if (boardType === "esp32s3" && hardwareUid.length >= 12) {
    return hardwareUid.slice(0, 12);
  }
  return hardwareUid;
}

function makeKey(boardType: string, hardwareUid: string) {
  return `${boardType}:${hardwareUid}`;
}

function mergeRows(existing: ProvisionedDeviceRecord, next: ProvisionedDeviceRecord): ProvisionedDeviceRecord {
  return {
    ...existing,
    label: existing.label || next.label,
    created_at_ms: Math.min(existing.created_at_ms, next.created_at_ms),
    updated_at_ms: Math.max(existing.updated_at_ms, next.updated_at_ms),
    last_seen_at_ms: Math.max(existing.last_seen_at_ms, next.last_seen_at_ms),
  };
}

export function normalizeBoardType(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeHardwareUid(value: string) {
  return value.trim().replace(/[-:\s]/g, "").toUpperCase();
}

class ProvisionedDevicesStore {
  private readonly rows: Map<string, ProvisionedDeviceRecord>;

  constructor() {
    const raw = readCollection<Record<string, ProvisionedDeviceRecord>>("provisioned_devices", {});
    const normalized = new Map<string, ProvisionedDeviceRecord>();
    let changed = false;

    for (const row of Object.values(raw)) {
      const boardType = normalizeBoardType(row.board_type);
      const hardwareUid = canonicalHardwareUid(boardType, normalizeHardwareUid(row.hardware_uid));
      const key = makeKey(boardType, hardwareUid);
      const next: ProvisionedDeviceRecord = {
        board_type: boardType,
        hardware_uid: hardwareUid,
        label: row.label || "",
        owner_firebase_uid: row.owner_firebase_uid,
        created_at_ms: row.created_at_ms,
        updated_at_ms: row.updated_at_ms,
        last_seen_at_ms: row.last_seen_at_ms,
      };
      const existing = normalized.get(key);

      if (!existing) {
        normalized.set(key, next);
      } else {
        normalized.set(key, mergeRows(existing, next));
        changed = true;
      }

      if (
        row.board_type !== boardType ||
        row.hardware_uid !== hardwareUid ||
        "device_id_b64" in (row as Record<string, unknown>) ||
        "proof_b64" in (row as Record<string, unknown>)
      ) {
        changed = true;
      }
    }

    this.rows = normalized;
    if (changed) {
      this.persist();
    }
  }

  private persist() {
    writeCollection("provisioned_devices", Object.fromEntries(this.rows.entries()));
  }

  get(boardType: string, hardwareUid: string) {
    const normalizedBoardType = normalizeBoardType(boardType);
    const normalizedHardwareUid = canonicalHardwareUid(normalizedBoardType, normalizeHardwareUid(hardwareUid));
    return this.rows.get(makeKey(normalizedBoardType, normalizedHardwareUid)) || null;
  }

  listByUser(firebaseUid: string) {
    const deduped = new Map<string, ProvisionedDeviceRecord>();
    for (const row of this.rows.values()) {
      if (row.owner_firebase_uid !== firebaseUid) continue;
      const key = makeKey(row.board_type, canonicalHardwareUid(row.board_type, row.hardware_uid));
      const existing = deduped.get(key);
      deduped.set(key, existing ? mergeRows(existing, row) : row);
    }

    return [...deduped.values()].sort((a, b) => {
      if (a.last_seen_at_ms !== b.last_seen_at_ms) {
        return b.last_seen_at_ms - a.last_seen_at_ms;
      }
      return b.created_at_ms - a.created_at_ms;
    });
  }

  claimOrRestore(input: {
    boardType: string;
    hardwareUid: string;
    ownerFirebaseUid: string;
  }) {
    const now = nowMs();
    const boardType = normalizeBoardType(input.boardType);
    const hardwareUid = canonicalHardwareUid(boardType, normalizeHardwareUid(input.hardwareUid));
    const key = makeKey(boardType, hardwareUid);
    const existing = this.rows.get(key);

    if (existing) {
      if (existing.owner_firebase_uid !== input.ownerFirebaseUid) {
        return { error: "device_owned_by_another_user" } as const;
      }
      const next: ProvisionedDeviceRecord = {
        board_type: existing.board_type,
        hardware_uid: existing.hardware_uid,
        label: existing.label,
        owner_firebase_uid: existing.owner_firebase_uid,
        created_at_ms: existing.created_at_ms,
        updated_at_ms: now,
        last_seen_at_ms: now,
      };
      this.rows.set(key, next);
      this.persist();
      return { device: next, created: false } as const;
    }

    const created: ProvisionedDeviceRecord = {
      board_type: boardType,
      hardware_uid: hardwareUid,
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
    const normalizedBoardType = normalizeBoardType(boardType);
    const normalizedHardwareUid = canonicalHardwareUid(normalizedBoardType, normalizeHardwareUid(hardwareUid));
    const key = makeKey(normalizedBoardType, normalizedHardwareUid);
    const existing = this.rows.get(key);
    if (!existing || existing.owner_firebase_uid !== firebaseUid) {
      return null;
    }

    const next: ProvisionedDeviceRecord = {
      board_type: existing.board_type,
      hardware_uid: existing.hardware_uid,
      label: label.slice(0, 128),
      owner_firebase_uid: existing.owner_firebase_uid,
      created_at_ms: existing.created_at_ms,
      updated_at_ms: nowMs(),
      last_seen_at_ms: existing.last_seen_at_ms,
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
