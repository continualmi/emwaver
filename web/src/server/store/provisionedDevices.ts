import {
  ensurePlatformUser,
  getProvisionedDevice,
  listProvisionedDevicesByUser,
  setProvisionedDeviceLabel,
  upsertProvisionedDevice,
} from "@/server/platformCore";
import { readCollection } from "./jsonStore";

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

function mapPlatformDevice(row: Record<string, unknown>): ProvisionedDeviceRecord {
  return {
    board_type: String(row.board_type),
    hardware_uid: String(row.hardware_uid),
    label: String(row.label ?? ""),
    owner_firebase_uid: String(row.owner_firebase_uid ?? ""),
    created_at_ms: Number(row.created_at_ms ?? 0),
    updated_at_ms: Number(row.updated_at_ms ?? 0),
    last_seen_at_ms: Number(row.last_seen_at_ms ?? 0),
  };
}

export function normalizeBoardType(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeHardwareUid(value: string) {
  return value.trim().replace(/[-:\s]/g, "").toUpperCase();
}

class ProvisionedDevicesStore {
  private readonly legacyRows: Map<string, ProvisionedDeviceRecord>;

  constructor() {
    const raw = readCollection<Record<string, ProvisionedDeviceRecord>>("provisioned_devices", {});
    const normalized = new Map<string, ProvisionedDeviceRecord>();

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
      }
    }

    this.legacyRows = normalized;
  }

  async get(boardType: string, hardwareUid: string) {
    const normalizedBoardType = normalizeBoardType(boardType);
    const normalizedHardwareUid = canonicalHardwareUid(normalizedBoardType, normalizeHardwareUid(hardwareUid));
    const platform = await getProvisionedDevice(normalizedBoardType, normalizedHardwareUid);
    if (platform) return mapPlatformDevice(platform);

    const legacy = this.legacyRows.get(makeKey(normalizedBoardType, normalizedHardwareUid)) || null;
    if (!legacy?.owner_firebase_uid) return legacy;

    const user = await ensurePlatformUser({ firebaseUid: legacy.owner_firebase_uid, email: null, displayName: null });
    const migrated = await upsertProvisionedDevice({
      boardType: normalizedBoardType,
      hardwareUid: normalizedHardwareUid,
      ownerUserId: user.id,
      ownerFirebaseUid: legacy.owner_firebase_uid,
      label: legacy.label,
    });
    return mapPlatformDevice(migrated);
  }

  async listByUser(firebaseUid: string) {
    const user = await ensurePlatformUser({ firebaseUid, email: null, displayName: null });
    const platformDevices = await listProvisionedDevicesByUser(user.id);
    if (platformDevices.length > 0) {
      return platformDevices.map((row) => mapPlatformDevice(row));
    }

    const legacyMatches = [...this.legacyRows.values()].filter((row) => row.owner_firebase_uid === firebaseUid);
    if (legacyMatches.length > 0) {
      await Promise.all(legacyMatches.map((row) => upsertProvisionedDevice({
        boardType: row.board_type,
        hardwareUid: row.hardware_uid,
        ownerUserId: user.id,
        ownerFirebaseUid: firebaseUid,
        label: row.label,
      })));
      const migrated = await listProvisionedDevicesByUser(user.id);
      if (migrated.length > 0) {
        return migrated.map((row) => mapPlatformDevice(row));
      }
    }

    const deduped = new Map<string, ProvisionedDeviceRecord>();
    for (const row of this.legacyRows.values()) {
      if (row.owner_firebase_uid !== firebaseUid) continue;
      const key = makeKey(row.board_type, canonicalHardwareUid(row.board_type, row.hardware_uid));
      const existing = deduped.get(key);
      deduped.set(key, existing ? mergeRows(existing, row) : row);
    }
    return [...deduped.values()].sort((a, b) => {
      if (a.last_seen_at_ms !== b.last_seen_at_ms) return b.last_seen_at_ms - a.last_seen_at_ms;
      return b.created_at_ms - a.created_at_ms;
    });
  }

  async claimOrRestore(input: {
    boardType: string;
    hardwareUid: string;
    ownerFirebaseUid: string;
  }) {
    const boardType = normalizeBoardType(input.boardType);
    const hardwareUid = canonicalHardwareUid(boardType, normalizeHardwareUid(input.hardwareUid));
    const user = await ensurePlatformUser({ firebaseUid: input.ownerFirebaseUid, email: null, displayName: null });
    const existingPlatform = await getProvisionedDevice(boardType, hardwareUid);
    if (existingPlatform) {
      const existingOwner = String(existingPlatform.owner_user_id ?? "");
      if (existingOwner && existingOwner !== user.id) {
        return { error: "device_owned_by_another_user" } as const;
      }
      const device = await upsertProvisionedDevice({
        boardType,
        hardwareUid,
        ownerUserId: user.id,
        ownerFirebaseUid: input.ownerFirebaseUid,
        label: String(existingPlatform.label ?? ""),
      });
      return { device: mapPlatformDevice(device), created: false } as const;
    }

    const key = makeKey(boardType, hardwareUid);
    const existingLegacy = this.legacyRows.get(key);
    if (existingLegacy && existingLegacy.owner_firebase_uid && existingLegacy.owner_firebase_uid !== input.ownerFirebaseUid) {
      return { error: "device_owned_by_another_user" } as const;
    }

    const device = await upsertProvisionedDevice({
      boardType,
      hardwareUid,
      ownerUserId: user.id,
      ownerFirebaseUid: input.ownerFirebaseUid,
      label: existingLegacy?.label ?? "",
    });
    return { device: mapPlatformDevice(device), created: !existingLegacy } as const;
  }

  async setLabel(boardType: string, hardwareUid: string, firebaseUid: string, label: string) {
    const normalizedBoardType = normalizeBoardType(boardType);
    const normalizedHardwareUid = canonicalHardwareUid(normalizedBoardType, normalizeHardwareUid(hardwareUid));
    const user = await ensurePlatformUser({ firebaseUid, email: null, displayName: null });
    const platform = await setProvisionedDeviceLabel({
      boardType: normalizedBoardType,
      hardwareUid: normalizedHardwareUid,
      userId: user.id,
      label,
    });
    if (platform) return mapPlatformDevice(platform);

    const key = makeKey(normalizedBoardType, normalizedHardwareUid);
    const existing = this.legacyRows.get(key);
    if (!existing || existing.owner_firebase_uid !== firebaseUid) return null;

    const user = await ensurePlatformUser({ firebaseUid, email: null, displayName: null });
    await upsertProvisionedDevice({
      boardType: normalizedBoardType,
      hardwareUid: normalizedHardwareUid,
      ownerUserId: user.id,
      ownerFirebaseUid: firebaseUid,
      label: existing.label,
    });
    const migrated = await setProvisionedDeviceLabel({
      boardType: normalizedBoardType,
      hardwareUid: normalizedHardwareUid,
      userId: user.id,
      label,
    });
    return migrated ? mapPlatformDevice(migrated) : {
      ...existing,
      label: label.slice(0, 128),
      updated_at_ms: nowMs(),
    };
  }

  async hasUserDevice(firebaseUid: string) {
    const devices = await this.listByUser(firebaseUid);
    return devices.length > 0;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverProvisionedDevicesStore?: ProvisionedDevicesStore;
};

export const provisionedDevicesStore =
  globalStore.__emwaverProvisionedDevicesStore ?? new ProvisionedDevicesStore();
globalStore.__emwaverProvisionedDevicesStore = provisionedDevicesStore;
